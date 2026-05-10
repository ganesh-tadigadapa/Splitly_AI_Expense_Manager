import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';

function AddExpenseModal({ isOpen, onClose, user, groupId, members, onExpenseAdded }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Food');
  const [paidBy, setPaidBy] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanItems, setScanItems] = useState([]);
  const [nlText, setNlText] = useState('');
  const [nlParsing, setNlParsing] = useState(false);
  const [autoCat, setAutoCat] = useState(false);
  const fileInputRef = useRef(null);
  const categoryTouchedRef = useRef(false);
  const titleDebounceRef = useRef(null);

  // Array of member names who are participating in the split
  const [splitBetween, setSplitBetween] = useState([]);

  useEffect(() => {
    if (isOpen) {
      // Reset form on open
      setTitle('');
      setAmount('');
      setCategory('Food');
      setPaidBy(user?.name || '');
      setScanItems([]);
      setNlText('');
      categoryTouchedRef.current = false;
      // By default, everyone is selected
      setSplitBetween(members || []);
    }
  }, [isOpen, members, user]);

  // Debounced auto-categorize when user types title manually
  useEffect(() => {
    if (!isOpen) return;
    if (categoryTouchedRef.current) return;
    if (!title || title.trim().length < 3) return;

    if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(async () => {
      try {
        setAutoCat(true);
        const { data } = await axios.post(
          `${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/ai/categorize`,
          { title }
        );
        if (data?.category && !categoryTouchedRef.current) {
          setCategory(data.category);
        }
      } catch (err) {
        // silent — categorize is best-effort
      } finally {
        setAutoCat(false);
      }
    }, 700);

    return () => {
      if (titleDebounceRef.current) clearTimeout(titleDebounceRef.current);
    };
  }, [title, isOpen]);

  const handleNlParse = async () => {
    if (!nlText.trim()) return;
    setNlParsing(true);
    try {
      const { data } = await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/ai/parse-expense`,
        { text: nlText, members, currentUser: user?.name || '' }
      );
      if (data.title) setTitle(data.title);
      if (data.amount) setAmount(String(data.amount));
      if (data.category) {
        setCategory(data.category);
        categoryTouchedRef.current = true;
      }
      if (data.paidBy) setPaidBy(data.paidBy);
      if (Array.isArray(data.splitBetween) && data.splitBetween.length > 0) {
        setSplitBetween(data.splitBetween);
      }
    } catch (err) {
      console.error('NL parse failed', err);
      alert(err.response?.data?.msg || 'Could not parse that. Try rephrasing.');
    } finally {
      setNlParsing(false);
    }
  };

  const handleReceiptUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('Please select an image file.');
      return;
    }

    setScanning(true);
    setScanItems([]);
    try {
      const base64 = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data } = await axios.post(
        `${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/ocr/receipt`,
        { image: base64, mimeType: file.type }
      );

      if (data.title) setTitle(data.title);
      if (data.amount) setAmount(String(data.amount));
      if (data.category) setCategory(data.category);
      if (Array.isArray(data.items)) setScanItems(data.items);
    } catch (err) {
      console.error('Receipt scan failed', err);
      alert(err.response?.data?.msg || 'Receipt scan failed. Make sure GEMINI_API_KEY is set on the server.');
    } finally {
      setScanning(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (!isOpen) return null;

  const toggleMember = (mName) => {
    if (splitBetween.includes(mName)) {
      setSplitBetween(splitBetween.filter(m => m !== mName));
    } else {
      setSplitBetween([...splitBetween, mName]);
    }
  };

  const handleSubmit = async () => {
    if (!title || !amount || splitBetween.length === 0) {
      alert("Please fill all required fields and select at least one person to split with.");
      return;
    }

    try {
      await axios.post(`${process.env.REACT_APP_API_URL || 'http://localhost:5001'}/api/expenses/add`, {
        title,
        amount: Number(amount),
        category,
        paidBy,
        members: members,
        splitBetween,
        groupId
      });
      
      onExpenseAdded();
      onClose();
    } catch (err) {
      console.error("Error adding expense", err);
      alert("Failed to add expense");
    }
  };

  const categories = ["Food", "Lodging", "Transport", "Activities", "Shopping", "General"];

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <button className="modal-close" onClick={onClose}>&times;</button>
        <h2 style={{ marginBottom: '16px', fontSize: '1.5rem', color: '#0f172a' }}>Add expense</h2>

        <div style={{
          background: 'linear-gradient(135deg, #eef2ff 0%, #fdf4ff 100%)',
          border: '1px solid #c7d2fe',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '12px'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#4338ca', marginBottom: '8px' }}>
            <strong>✨ AI Quick Entry</strong>
            <span style={{ color: '#6b7280', fontWeight: 400 }}> — describe the expense in one line.</span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <input
              type="text"
              placeholder='e.g. "I paid 600 for pizza for me, Raj and Anu"'
              value={nlText}
              onChange={(e) => setNlText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleNlParse(); }}
              style={{ flex: 1, padding: '8px 10px', borderRadius: '6px', border: '1px solid #c7d2fe', fontSize: '0.9rem' }}
            />
            <button
              type="button"
              className="btn-primary"
              disabled={nlParsing || !nlText.trim()}
              onClick={handleNlParse}
              style={{ padding: '8px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
            >
              {nlParsing ? 'Parsing…' : 'Parse'}
            </button>
          </div>
        </div>

        <div style={{
          background: '#f1f5f9',
          border: '1px dashed #94a3b8',
          borderRadius: '8px',
          padding: '12px',
          marginBottom: '20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px'
        }}>
          <div style={{ fontSize: '0.85rem', color: '#475569' }}>
            <strong>📷 AI Receipt Scan</strong>
            <div>Upload a receipt photo and we'll auto-fill the form.</div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleReceiptUpload}
          />
          <button
            type="button"
            className="btn-primary"
            disabled={scanning}
            onClick={() => fileInputRef.current?.click()}
            style={{ padding: '8px 14px', fontSize: '0.85rem', whiteSpace: 'nowrap' }}
          >
            {scanning ? 'Scanning…' : 'Scan receipt'}
          </button>
        </div>

        {scanItems.length > 0 && (
          <div style={{
            background: '#ecfdf5',
            border: '1px solid #6ee7b7',
            borderRadius: '8px',
            padding: '10px 12px',
            marginBottom: '20px',
            fontSize: '0.8rem',
            color: '#065f46'
          }}>
            <strong>Detected items:</strong>
            <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>
              {scanItems.map((it, i) => (
                <li key={i}>{it.name} — ₹{it.price}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="form-group">
          <label style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: '600' }}>What was it for?</label>
          <input 
            type="text" 
            placeholder="e.g. Pizza dinner" 
            value={title} 
            onChange={(e) => setTitle(e.target.value)} 
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: '600' }}>Amount</label>
            <input 
              type="number" 
              placeholder="0.00" 
              value={amount} 
              onChange={(e) => setAmount(e.target.value)} 
            />
          </div>
          <div className="form-group">
            <label style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
              Category
              {autoCat && <span style={{ fontSize: '0.7rem', color: '#6366f1', fontWeight: '500' }}>✨ AI…</span>}
            </label>
            <select
              className="form-input"
              value={category}
              onChange={(e) => { categoryTouchedRef.current = true; setCategory(e.target.value); }}
            >
              {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
            </select>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: '24px' }}>
          <label style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: '600' }}>Paid by</label>
          <select className="form-input" value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
            {members.map(m => (
              <option key={m} value={m}>{m === user?.name ? 'You' : m}</option>
            ))}
          </select>
        </div>

        <div className="form-group">
          <label style={{ fontSize: '0.9rem', color: '#0f172a', fontWeight: '600', marginBottom: '12px', display: 'block' }}>Split between</label>
          <div className="split-checklist">
            {members.map(m => {
              const isSelected = splitBetween.includes(m);
              const displayName = m === user?.name ? 'You' : m;
              return (
                <div 
                  key={m} 
                  className={`split-check-item ${isSelected ? 'selected' : ''}`}
                  onClick={() => toggleMember(m)}
                >
                  <div className="check-circle"></div>
                  {displayName}
                </div>
              );
            })}
          </div>
        </div>

        <button className="btn-primary" style={{ width: '100%', marginTop: '32px' }} onClick={handleSubmit}>
          Add expense
        </button>
      </div>
    </div>
  );
}

export default AddExpenseModal;
