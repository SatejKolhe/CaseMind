import React, { useState } from 'react';

/**
 * Sidebar Component (ChatGPT / Gemini / Claude Style)
 *
 * Specific requirements:
 * - Removed images, scheduled, plugins, codex, and recent sections.
 * - "+ New chat" button at top.
 * - "Projects" section listing all projects/cases; clicking opens that project chat.
 * - Profile section at bottom matching screenshot: Avatar, "Chintan Makwana", "Free", and "Claim offer".
 */
export default function Sidebar({
  projects = [],
  activeProjectId,
  onSelectProject,
  onNewChat,
  currentUser,
  onLogout,
  isOpen = true,
  onToggle,
  onUpdateUser,
}) {
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearch, setShowSearch] = useState(false);

  // Profile Edit modal states
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [editName, setEditName] = useState(currentUser?.name || '');
  const [editEmail, setEditEmail] = useState(currentUser?.email || '');

  const handleSaveProfile = (e) => {
    if (e) e.preventDefault();
    if (!editName.trim() || !editEmail.trim()) {
      alert('Username and email cannot be empty.');
      return;
    }

    const initials = editName
      .trim()
      .split(' ')
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();

    const updated = {
      ...currentUser,
      name: editName.trim(),
      email: editEmail.trim(),
      avatarText: initials || 'U',
    };

    localStorage.setItem('casemind_user', JSON.stringify(updated));
    if (onUpdateUser) {
      onUpdateUser(updated);
    }
    setShowProfileModal(false);
  };

  // Filter projects by search query
  const filteredProjects = projects.filter((proj) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const title = (proj.title || '').toLowerCase();
    const desc = (proj.description || '').toLowerCase();
    return title.includes(q) || desc.includes(q);
  });

  return (
    <aside className={`chat-sidebar ${!isOpen ? 'chat-sidebar-collapsed' : ''}`}>
      {/* Top Section matching screenshot */}
      <div className="chat-sidebar-top">
        {/* Top Header Row: CaseMind + Search Icon + Split Sidebar Icon */}
        <div className="sidebar-header-row">
          <span className="sidebar-brand-name">CaseMind</span>
          <div className="sidebar-header-actions">
            <button
              type="button"
              className={`btn-sidebar-icon ${showSearch ? 'active' : ''}`}
              onClick={() => setShowSearch((prev) => !prev)}
              title="Search cases"
              aria-label="Search cases"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button
              type="button"
              className="btn-sidebar-icon"
              onClick={onToggle}
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          </div>
        </div>

        {/* New chat button matching the reference screenshot */}
        <button type="button" className="btn-new-chat" onClick={onNewChat}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
          <span>New chat</span>
        </button>

        {/* Search input when toggled */}
        {showSearch && (
          <div className="sidebar-search-box">
            <span className="sidebar-search-icon">🔍</span>
            <input
              type="text"
              className="sidebar-search-input"
              placeholder="Search cases..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoFocus
            />
            {searchQuery && (
              <button
                type="button"
                className="btn-clear-search"
                onClick={() => setSearchQuery('')}
                title="Clear search"
              >
                ✕
              </button>
            )}
          </div>
        )}
      </div>

      {/* Projects Section */}
      <div className="sidebar-section-header">
        <span>Projects {searchQuery && `(${filteredProjects.length})`}</span>
        <button
          type="button"
          onClick={onNewChat}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-subtle)', cursor: 'pointer', fontSize: '1rem' }}
          title="Create New Project Case"
        >
          +
        </button>
      </div>

      <div className="sidebar-projects-list">
        {projects.length === 0 ? (
          <div className="project-empty-hint">No projects yet. Start a new case above.</div>
        ) : filteredProjects.length === 0 ? (
          <div className="project-empty-hint">No cases match "{searchQuery}"</div>
        ) : (
          filteredProjects.map((proj) => {
            const isActive = proj._id === activeProjectId;
            return (
              <button
                key={proj._id}
                type="button"
                className={`project-item-btn ${isActive ? 'active' : ''}`}
                onClick={() => onSelectProject(proj._id)}
                title={proj.title}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {proj.title}
                </span>
              </button>
            );
          })
        )}
      </div>

      {/* Profile Section (Identical to reference screenshot) */}
      <div className="chat-sidebar-profile">
        {showProfileMenu && (
          <div className="profile-dropdown">
            <div style={{ padding: '8px 10px', fontSize: '0.8rem', color: 'var(--text-main)', borderBottom: '1px solid var(--border-subtle)' }}>
              <div style={{ fontWeight: 600 }}>{currentUser?.name || 'User'}</div>
              <div style={{ fontSize: '0.74rem', color: 'var(--text-subtle)' }}>{currentUser?.email}</div>
            </div>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => {
                setEditName(currentUser?.name || '');
                setEditEmail(currentUser?.email || '');
                setShowProfileMenu(false);
                setShowProfileModal(true);
              }}
            >
              <span>👤</span>
              <span>Account & Profile Settings</span>
            </button>
            <button
              type="button"
              className="dropdown-item"
              onClick={() => alert('CaseMind Pro Tier: Unlimited AI Synthesis & Evidence Storage.')}
            >
              <span>⭐</span>
              <span>Upgrade to Pro</span>
            </button>
            <button
              type="button"
              className="dropdown-item danger"
              onClick={onLogout}
            >
              <span>⎋</span>
              <span>Sign out</span>
            </button>
          </div>
        )}

        {/* Profile Card matching image */}
        <button
          type="button"
          className="profile-card"
          onClick={() => setShowProfileMenu((prev) => !prev)}
        >
          <div className="profile-avatar" style={{ backgroundColor: currentUser?.avatarColor || '#facc15' }}>
            {currentUser?.avatarText || 'CM'}
          </div>
          <div className="profile-info">
            <span className="profile-name">{currentUser?.name || 'Chintan Makwana'}</span>
            <span className="profile-tier">{currentUser?.plan || 'Free'}</span>
          </div>
        </button>
      </div>

      {/* Account & Profile Edit Modal */}
      {showProfileModal && (
        <div className="modal-backdrop" onClick={() => setShowProfileModal(false)}>
          <div className="modal-box" style={{ maxWidth: '440px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Account & Profile Settings</h2>
              <button
                type="button"
                className="btn-close-modal"
                onClick={() => setShowProfileModal(false)}
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="profile-modal-body">
              <div className="profile-input-group">
                <label>Username / Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Enter username"
                  required
                />
              </div>

              <div className="profile-input-group">
                <label>Email Address</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  placeholder="name@gmail.com"
                  required
                />
              </div>

              <div className="profile-input-group">
                <label>Workspace Plan</label>
                <input
                  type="text"
                  value={currentUser?.plan || 'Free'}
                  disabled
                  style={{ opacity: 0.6 }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '12px' }}>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => setShowProfileModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </aside>
  );
}
