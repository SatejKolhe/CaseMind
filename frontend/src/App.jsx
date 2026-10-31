import React, { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './components/Sidebar';
import ChatWorkspace from './components/ChatWorkspace';
import GoogleAuthModal from './components/GoogleAuthModal';
import { listCases } from './api';

function MainAppShell() {
  const navigate = useNavigate();
  const { caseId: routeCaseId } = useParams();

  // Authentication State (Google Auth as mandatory single option)
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem('casemind_user');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Cases / Projects State
  const [projects, setProjects] = useState([]);
  const [localActiveId, setLocalActiveId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);

  // Active project is derived from URL param if present, else local selection
  const activeProjectId = routeCaseId || localActiveId;

  useEffect(() => {
    let ignore = false;
    if (!currentUser) return;
    async function load() {
      try {
        const list = await listCases();
        if (!ignore) {
          setProjects(Array.isArray(list) ? list : []);
        }
      } catch (err) {
        console.error('Failed to load project cases:', err);
      }
    }
    load();
    return () => {
      ignore = true;
    };
  }, [currentUser]);

  const handleLoginSuccess = (user) => {
    setCurrentUser(user);
  };

  const handleLogout = () => {
    localStorage.removeItem('casemind_user');
    setCurrentUser(null);
  };

  const handleSelectProject = (id) => {
    setLocalActiveId(id);
    navigate(`/cases/${id}`);
  };

  const handleNewChat = () => {
    setLocalActiveId(null);
    navigate('/');
  };

  const handleCaseCreated = (newCase) => {
    setProjects((prev) => [newCase, ...prev]);
    setLocalActiveId(newCase._id);
    navigate(`/cases/${newCase._id}`);
  };

  // If user is not authenticated, show Google Sign-In Modal exclusively
  if (!currentUser) {
    return <GoogleAuthModal onLoginSuccess={handleLoginSuccess} />;
  }

  const activeCase = projects.find((p) => p._id === activeProjectId) || null;

  return (
    <div className="chat-app-layout">
      {/* ChatGPT / Claude Dark Sidebar */}
      <Sidebar
        projects={projects}
        activeProjectId={activeProjectId}
        onSelectProject={handleSelectProject}
        onNewChat={handleNewChat}
        currentUser={currentUser}
        onLogout={handleLogout}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen((prev) => !prev)}
        onUpdateUser={(updated) => setCurrentUser(updated)}
      />

      {/* Main Conversational Workspace */}
      <ChatWorkspace
        activeCase={activeCase}
        onCaseCreated={handleCaseCreated}
        onToggleSidebar={() => setSidebarOpen((prev) => !prev)}
        sidebarOpen={sidebarOpen}
      />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<MainAppShell />} />
        <Route path="/cases/:caseId" element={<MainAppShell />} />
        <Route path="*" element={<MainAppShell />} />
      </Routes>
    </BrowserRouter>
  );
}
