import { useState, useEffect } from 'react';

const API_BASE = import.meta.env.VITE_API_URL ?? '';

export default function App() {
  const [items, setItems] = useState([]);
  const [input, setInput] = useState('');

  useEffect(() => {
    fetch(`${API_BASE}/api/items`)
      .then(r => r.json())
      .then(setItems)
      .catch(console.error);
  }, []);

  async function addItem(e) {
    e.preventDefault();
    if (!input.trim()) return;
    const res = await fetch(`${API_BASE}/api/items`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: input.trim() }),
    });
    const item = await res.json();
    setItems(prev => [item, ...prev]);
    setInput('');
  }

  async function deleteItem(id) {
    await fetch(`${API_BASE}/api/items/${id}`, { method: 'DELETE' });
    setItems(prev => prev.filter(i => i.id !== id));
  }

  return (
    <div style={{ maxWidth: 480, margin: '2rem auto', fontFamily: 'sans-serif' }}>
      <h1>todo2</h1>
      <form onSubmit={addItem} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="New item..."
          style={{ flex: 1, padding: '6px 10px' }}
        />
        <button type="submit">Add</button>
      </form>
      <ul style={{ listStyle: 'none', padding: 0 }}>
        {items.map(item => (
          <li key={item.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #eee' }}>
            <span>{item.name}</span>
            <button onClick={() => deleteItem(item.id)} style={{ cursor: 'pointer' }}>✕</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
