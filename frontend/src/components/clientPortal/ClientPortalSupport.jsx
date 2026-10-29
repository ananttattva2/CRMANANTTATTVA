import React, { useEffect, useState } from 'react';
import { Mail, MessageSquare, Send, ShieldCheck } from 'lucide-react';
export default function ClientPortalSupport({ clients, api, token }) {
  const [lead, setLead] = useState(String(clients[0]?._id || ''));
  const [contacts, setContacts] = useState([]), [recipient, setRecipient] = useState('');
  const [messages, setMessages] = useState([]), [body, setBody] = useState('');
  const [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  useEffect(() => {
    let active = true;
    setLoading(true); setError(''); setContacts([]); setMessages([]); setRecipient(''); setNotice('');
    const config = { headers: { Authorization: `Bearer ${token}` }, params: { lead } };
    Promise.all([api.get('/support/contacts', config), api.get('/support/messages', config)]).then(([people, history]) => { if (active) { setContacts(people.data); setMessages(history.data); } }).catch(err => { if (active) setError(err.response?.data?.error || 'Support could not be loaded. Please refresh.'); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [api, token, lead]);
  async function send(event) {
    event.preventDefault();
    if (!recipient || !body.trim() || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      const { data } = await api.post('/support/messages', { lead, recipient, message: body.trim() }, { headers: { Authorization: `Bearer ${token}` } });
      setMessages(current => [data, ...current]); setBody('');
      setNotice(data.emailStatus === 'sent' ? 'Message sent by email to your selected contact. They can follow up using your registered email.' : 'Message saved, but the email could not be delivered. Please contact your account team directly.');
    } catch (err) { setError(err.response?.data?.error || 'Message could not be sent. Please try again.'); }
    finally { setBusy(false); }
  }
  return <div className="cp-support-workspace"><section className="cp-panel cp-support-compose"><header className="cp-panel-heading"><div><h2><MessageSquare size={20} />Contact your team</h2><p>Choose your sales contact, SPOC or technical support.</p></div></header><form onSubmit={send}><label>Company<select disabled={busy} value={lead} onChange={event => setLead(event.target.value)}>{clients.map(client => <option key={client._id} value={client._id}>{client.company}</option>)}</select></label><label>Send message to<select required disabled={loading || busy} value={recipient} onChange={event => setRecipient(event.target.value)}><option value="">{loading ? 'Loading contacts…' : 'Select a team member'}</option>{contacts.map(person => <option key={person.id} value={person.id}>{person.name} — {person.role} ({person.email})</option>)}</select></label>{recipient && <div className="cp-recipient-note"><Mail size={16} /><span>{contacts.find(person => person.id === recipient)?.email}</span></div>}<label>Your message<textarea required maxLength={5000} rows={6} disabled={busy} value={body} onChange={event => setBody(event.target.value)} placeholder="Describe the issue or question you need help with…" /></label><small>{body.length.toLocaleString()} / 5,000 characters</small>{error && <p className="cp-error" role="alert">{error}</p>}{notice && <p className="cp-support-notice" role="status">{notice}</p>}<button className="cp-button cp-upload-submit" disabled={busy || loading || !recipient || !body.trim()}><Send size={16} />{busy ? 'Sending…' : 'Send message'}</button></form><p className="cp-support-privacy"><ShieldCheck size={15} />Your message is emailed only to the contact you select.</p></section><section className="cp-panel cp-support-thread"><header className="cp-panel-heading"><div><h2>Message history</h2><p>Your submitted messages and email delivery status.</p></div></header>{loading ? <p role="status">Loading messages…</p> : !messages.length ? <div className="cp-message-empty"><MessageSquare size={38} /><h3>How can we help?</h3><p>Send a message to start a conversation with your team.</p></div> : <div className="cp-message-list">{[...messages].reverse().map(message => <article key={message._id}><header><strong>To {message.recipientName}</strong><span>{message.recipientRole}</span></header><p>{message.body}</p><footer><time>{new Date(message.createdAt).toLocaleString('en-IN')}</time><span>{message.emailStatus === 'sent' ? 'Email sent' : message.emailStatus === 'failed' ? 'Email delivery failed' : 'Email pending'}</span></footer></article>)}</div>}</section></div>;
}
