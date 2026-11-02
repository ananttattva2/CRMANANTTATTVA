import React, { useEffect, useState } from 'react';
import ProfileModal from './ProfileModal';
import api from '../../services/api';
import { API_ENDPOINTS } from '../../services/apiEndpoints';

export default function ConnectedProfileSettings({ user, onUpdated, onClose, onLogout }) {
  const [profile, setProfile] = useState(user || {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    api.get(API_ENDPOINTS.auth.me).then(response => { if (active) { setProfile(response.data.user); onUpdated?.(response.data.user); } })
      .catch(error => { if (active) setError(error.response?.data?.error || 'Unable to refresh your profile. Please try again.'); });
    return () => { active = false; };
  }, [onUpdated]);
  async function saveProfile(values) {
    setSaving(true); setError('');
    try {
      const response = await api.put(API_ENDPOINTS.auth.me, values);
      setProfile(response.data.user); onUpdated?.(response.data.user);
      try { localStorage.setItem('user', JSON.stringify(response.data.user)); } catch { /* Profile still works when browser storage is unavailable. */ }
      window.dispatchEvent(new Event('crm-user-updated'));
    } catch (error) { throw new Error(error.response?.data?.error || 'Unable to save your profile.'); }
    finally { setSaving(false); }
  }
  async function updatePassword(values) {
    setSaving(true);
    try { await api.put(API_ENDPOINTS.auth.password, values); }
    catch (error) { throw new Error(error.response?.data?.error || 'Unable to update your password.'); }
    finally { setSaving(false); }
  }
  return <ProfileModal key={profile._id || profile.id || 'loading'} user={profile} saving={saving} error={error} onClose={onClose} onLogout={onLogout} onSave={saveProfile} onUpdatePassword={updatePassword}/>;
}
