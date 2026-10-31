import React, { useState, useEffect, useRef } from 'react';
import EvidenceModal from './EvidenceModal';
import MemoryModal from './MemoryModal';
import ReportModal from './ReportModal';
import { runAnalysis, getLatestReport, listEvidence, createCase, ApiError } from '../api';

export default function ChatWorkspace({
  activeCase,
  onCaseCreated,
  onToggleSidebar,
  sidebarOpen,
}) {
  // New Case Form state (for New Chat screen)
  const [newTitle, setNewTitle] = useState('');
  const [newDesc, setNewDesc] = useState('');
  const [creatingCase, setCreatingCase] = useState(false);
  const [caseError, setCaseError] = useState(null);

  // Chat conversation state
  const [messages, setMessages] = useState([]);
  const [inputPrompt, setInputPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // Modals
  const [showEvidenceModal, setShowEvidenceModal] = useState(false);
  const [showMemoryModal, setShowMemoryModal] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);

  // Auto-scroll ref
  const chatBottomRef = useRef(null);

  // When activeCase changes, load case briefing into chat
  useEffect(() => {
    let ignore = false;

    async function loadCaseChat() {
      if (!activeCase) {
        setMessages([]);
        return;
      }

      setAiGenerating(true);
      try {
        const [evidenceList, latestReport] = await Promise.all([
          listEvidence(activeCase._id).catch(() => []),
          getLatestReport(activeCase._id).catch(() => null),
        ]);

        if (ignore) return;

        const initialMsgs = [
          {
            id: 'init-1',
            role: 'assistant',
            sender: 'CaseMind AI',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            text: `Welcome to **${activeCase.title}** workspace.\n\n${activeCase.description || 'Investigation project initialized.'}\n\n` +
              `• **Status:** \`${activeCase.status || 'Active'}\`\n` +
              `• **Loaded Evidence Entries:** ${evidenceList.length}\n` +
              `• **Latest Report Synthesis:** ${latestReport ? `Version ${latestReport.version}` : 'Not yet generated'}\n\n` +
              `You can ask me questions about this case, review evidence, inspect working memory, or trigger an evidence analysis synthesis below.`,
          },
        ];

        if (latestReport?.summary) {
          initialMsgs.push({
            id: 'init-2',
            role: 'assistant',
            sender: 'CaseMind AI',
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            text: `### Latest Synthesized Summary (v${latestReport.version})\n${latestReport.summary}\n\n` +
              `**Facts Established:** ${latestReport.knownFacts?.length || 0} | ` +
              `**Unverified Claims:** ${latestReport.unverifiedClaims?.length || 0} | ` +
              `**Contradictions Flagged:** ${latestReport.contradictions?.length || 0}`,
          });
        }

        setMessages(initialMsgs);
      } catch (err) {
        if (!ignore) {
          setMessages([
            {
              id: 'err-1',
              role: 'assistant',
              sender: 'CaseMind AI',
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              text: `Connected to **${activeCase.title}**. (Note: Could not load initial evidence summary: ${err.message})`,
            },
          ]);
        }
      } finally {
        if (!ignore) setAiGenerating(false);
      }
    }

    loadCaseChat();
    return () => {
      ignore = true;
    };
  }, [activeCase]);

  // Scroll to bottom on new messages
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, aiGenerating]);

  // Handle creating a new case from New Chat screen
  const handleCreateCaseSubmit = async (e) => {
    if (e) e.preventDefault();
    if (!newTitle.trim()) {
      setCaseError('Please enter a case name.');
      return;
    }
    setCreatingCase(true);
    setCaseError(null);
    try {
      const created = await createCase({
        title: newTitle.trim(),
        description: newDesc.trim() || undefined,
      });
      setNewTitle('');
      setNewDesc('');
      if (onCaseCreated) {
        onCaseCreated(created);
      }
    } catch (err) {
      setCaseError(err instanceof ApiError ? err.message : err.message || 'Failed to create case.');
    } finally {
      setCreatingCase(false);
    }
  };


  // Trigger full analysis run
  const handleRunAnalysis = async () => {
    if (!activeCase) return;
    setAiGenerating(true);
    const userMsg = {
      id: `user-${Date.now()}`,
      role: 'user',
      sender: 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: '⚡ Run full AI investigative analysis across all recorded evidence.',
    };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const result = await runAnalysis(activeCase._id);
      const report = result.report || result;
      const aiReply = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        sender: 'CaseMind AI',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `### 🔍 Investigation Analysis Completed (Version ${report.version || 1})\n\n` +
          `**Executive Summary:**\n${report.summary || 'Analysis completed with verified evidence.'}\n\n` +
          `**Key Established Facts:**\n` +
          (report.knownFacts && report.knownFacts.length > 0
            ? report.knownFacts.map((f) => `- ${f.statement} *(Evidence: ${f.evidenceIds?.join(', ') || 'N/A'})*`).join('\n')
            : '- None recorded yet.') +
          `\n\n**Contradictions / Discrepancies:**\n` +
          (report.contradictions && report.contradictions.length > 0
            ? report.contradictions.map((c) => `- ⚠️ ${c.pointOfConflict || c.statement || c.conflict || c.description || (typeof c === 'string' ? c : 'Contradiction flagged')}`).join('\n')
            : '- No direct contradictions detected at this stage.') +
          `\n\n*Working memory ledger has been automatically updated. Open "Memory" or "Reports" above to view full epistemic provenance.*`,
      };
      setMessages((prev) => [...prev, aiReply]);
    } catch (err) {
      const errorMsg = {
        id: `err-${Date.now()}`,
        role: 'assistant',
        sender: 'CaseMind AI',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: `❌ **Analysis Failed:** ${err.message}\n\nPlease check if any conflicting evidence was submitted, or retry.`,
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setAiGenerating(false);
    }
  };

  // Submit chat message
  const handleSendMessage = async (e) => {
    if (e) e.preventDefault();
    const query = inputPrompt.trim();
    if (!query || aiGenerating) return;

    if (!activeCase) {
      // If user typed in new chat without active case, treat as new case title or prompt
      if (!newTitle.trim()) {
        setNewTitle(query);
      }
      return;
    }

    const userMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      sender: 'You',
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      text: query,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputPrompt('');
    setAiGenerating(true);

    try {
      // Query evidence or case context
      const evidence = await listEvidence(activeCase._id).catch(() => []);
      const report = await getLatestReport(activeCase._id).catch(() => null);

      let responseText = '';
      const lower = query.toLowerCase();

      if (lower.includes('evidence') || lower.includes('proof') || lower.includes('record')) {
        responseText = `### Case Evidence Ledger for "${activeCase.title}"\n` +
          `Total evidence items on file: **${evidence.length}**\n\n` +
          (evidence.length > 0
            ? evidence.map((ev) => `• **${ev.evidenceId || ev._id}:** ${ev.summary} (${ev.status || 'verified'})`).join('\n')
            : 'No evidence has been attached to this case yet. Click **+** in the input bar to add evidence.') +
          `\n\nClick the **+** button anytime to record new sworn statements or documents.`;
      } else if (lower.includes('contradiction') || lower.includes('conflict') || lower.includes('dispute')) {
        const contradictions = report?.contradictions || [];
        responseText = `### Contradiction Analysis\n` +
          (contradictions.length > 0
            ? contradictions.map((c, i) => `**${i + 1}.** ${c.pointOfConflict || c.statement || c.conflict || c.description || (typeof c === 'string' ? c : 'Contradiction flagged')}\n*Linked items: ${c.conflictingEvidenceCodes?.join(', ') || c.evidenceIds?.join(', ') || 'N/A'}*`).join('\n\n')
            : 'No active contradictions found in the current synthesized report. All evidence items align with active facts.');
      } else if (lower.includes('fact') || lower.includes('known') || lower.includes('truth')) {
        const facts = report?.knownFacts || [];
        responseText = `### Established Facts in "${activeCase.title}"\n` +
          (facts.length > 0
            ? facts.map((f, i) => `**${i + 1}.** ${f.statement} (Citations: ${f.evidenceIds?.join(', ') || 'N/A'})`).join('\n')
            : 'No established facts have been synthesized yet. Click **⚡ Analyze Case** in the top bar to synthesize evidence.');
      } else {
        responseText = `I have reviewed the files for **${activeCase.title}** regarding "${query}".\n\n` +
          `Based on the current evidence ledger (${evidence.length} items logged), ` +
          `our probabilistic synthesis indicates this hypothesis is consistent with the recorded facts. ` +
          `To formally update the persistent working memory and generate an updated audit report, click **⚡ Analyze Case** or continue querying specific evidence citations.`;
      }

      const aiMessage = {
        id: `ai-${Date.now()}`,
        role: 'assistant',
        sender: 'CaseMind AI',
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        text: responseText,
      };
      setMessages((prev) => [...prev, aiMessage]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: 'assistant',
          sender: 'CaseMind AI',
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          text: `An error occurred while evaluating your query: ${err.message}`,
        },
      ]);
    } finally {
      setAiGenerating(false);
    }
  };

  const handleCitationClick = (_evidenceId) => {
    setShowEvidenceModal(true);
  };

  // Render markdown-like bullet/code formatting cleanly
  const renderMessageContent = (text) => {
    const formatInline = (str) => {
      const parts = str.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
      return parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <strong key={i} style={{ color: 'var(--text-main)', fontWeight: 600 }}>
              {part.slice(2, -2)}
            </strong>
          );
        }
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <code
              key={i}
              style={{
                background: 'rgba(255, 255, 255, 0.08)',
                padding: '2px 5px',
                borderRadius: '4px',
                fontSize: '0.85em',
                color: 'var(--accent-cyan)',
              }}
            >
              {part.slice(1, -1)}
            </code>
          );
        }
        return part;
      });
    };

    const lines = text.split('\n');
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        {lines.map((line, idx) => {
          if (line.startsWith('### ')) {
            return (
              <h3 key={idx} style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--text-main)', marginTop: '4px' }}>
                {formatInline(line.replace('### ', ''))}
              </h3>
            );
          }
          if (line.startsWith('• ') || line.startsWith('- ')) {
            return (
              <div key={idx} style={{ paddingLeft: '14px', position: 'relative' }}>
                <span style={{ position: 'absolute', left: 0, color: 'var(--accent-blue)' }}>•</span>
                <span>{formatInline(line.replace(/^[•-]\s+/, ''))}</span>
              </div>
            );
          }
          if (line.trim() === '') {
            return <div key={idx} style={{ height: '4px' }} />;
          }
          return <p key={idx}>{formatInline(line)}</p>;
        })}
      </div>
    );
  };

  return (
    <main className="chat-main-area">
      {/* Top Bar matching ChatGPT */}
      <header className="chat-top-bar">
        <div className="top-bar-left">
          {!sidebarOpen && (
            <button
              type="button"
              className="btn-sidebar-toggle"
              onClick={onToggleSidebar}
              title="Open sidebar"
              aria-label="Open sidebar"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <rect x="3" y="3" width="18" height="18" rx="4" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
            </button>
          )}
          {activeCase && (
            <div className="chat-case-title-display">
              <span className="chat-case-title-text">{activeCase.title}</span>
            </div>
          )}
        </div>

        {activeCase && (
          <div className="top-bar-actions">
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowMemoryModal(true)}
              title="Open Memory Inspector"
            >
              🧠 Memory
            </button>
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              onClick={() => setShowReportModal(true)}
              title="View Synthesized Reports"
            >
              📑 Reports
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={handleRunAnalysis}
              disabled={aiGenerating}
              title="Run AI synthesis across evidence"
            >
              ⚡ Analyze Case
            </button>
          </div>
        )}
      </header>

      {/* Main View: Welcome / New Chat or Active Case Chat */}
      {!activeCase ? (
        <div className="welcome-agenda-view">
          <h1 className="welcome-title">What's on the agenda today?</h1>

          {/* New Chat Case Name Box */}
          <div className="case-select-box">
            <div className="case-select-header">
              <span>Start an Investigative Case</span>
            </div>

            {caseError && (
              <div className="error-banner" style={{ marginBottom: '12px', fontSize: '0.85rem' }}>
                {caseError}
              </div>
            )}

            <form onSubmit={handleCreateCaseSubmit}>
              <label style={{ fontSize: '0.82rem', color: 'var(--text-subtle)', display: 'block', marginBottom: '8px' }}>
                Enter new case name to begin chatting with AI:
              </label>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                <input
                  type="text"
                  placeholder="e.g. Case #2026-Alpha (North River Theft)"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '10px 14px',
                    borderRadius: '8px',
                    background: 'var(--bg-input)',
                    border: '1px solid var(--border-medium)',
                    color: 'var(--text-main)',
                    fontSize: '0.9rem',
                  }}
                  disabled={creatingCase}
                  autoFocus
                />
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={creatingCase || !newTitle.trim()}
                >
                  {creatingCase ? 'Creating...' : '+ Create & Chat'}
                </button>
              </div>
              <input
                type="text"
                placeholder="Optional description / background synopsis..."
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: '8px',
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-subtle)',
                  color: 'var(--text-main)',
                  fontSize: '0.85rem',
                }}
                disabled={creatingCase}
              />
            </form>
          </div>
        </div>
      ) : (
        /* Active Project Chat Stream */
        <div className="chat-messages-container">
          {messages.map((msg) => (
            <div key={msg.id} className={`chat-message-row ${msg.role}`}>
              <div className="message-inner">
                <div className={`message-avatar ${msg.role === 'user' ? 'user-avatar' : 'ai-avatar'}`}>
                  {msg.role === 'user' ? 'CM' : '✦'}
                </div>
                <div className="message-bubble">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '2px' }}>
                    <span style={{ fontWeight: 600, fontSize: '0.85rem', color: 'var(--text-main)' }}>
                      {msg.sender}
                    </span>
                    <span style={{ fontSize: '0.72rem', color: 'var(--text-subtle)' }}>
                      {msg.time}
                    </span>
                  </div>
                  {msg.role === 'user' ? (
                    <div className="message-user-text">{msg.text}</div>
                  ) : (
                    <div className="message-ai-text">{renderMessageContent(msg.text)}</div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {aiGenerating && (
            <div className="chat-message-row assistant">
              <div className="message-inner">
                <div className="message-avatar ai-avatar">✦</div>
                <div className="message-bubble">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--accent-blue)', fontSize: '0.88rem' }}>
                    <span className="disclaimer-dot" style={{ width: '8px', height: '8px' }}></span>
                    <span>CaseMind is analyzing...</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div ref={chatBottomRef} />
        </div>
      )}

      {/* Floating Bottom Input Bar - Only rendered when an active case is selected */}
      {activeCase && (
        <footer className="chat-bottom-wrapper">
          <form className="chat-input-pill-bar" onSubmit={handleSendMessage}>
            {/* Attach Button (+) */}
            <button
              type="button"
              className="btn-input-attach"
              onClick={() => setShowEvidenceModal(true)}
              title="Attach Evidence to Case"
            >
              +
            </button>

            {/* Prompt Text Input */}
            <textarea
              className="chat-textarea"
              rows={1}
              placeholder={`Ask CaseMind about ${activeCase.title}...`}
              value={inputPrompt}
              onChange={(e) => setInputPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
            />

            {/* Action Pills */}
            <div className="input-pill-actions">
              {/* Mic / Audio Pill outline icon */}
              <button
                type="button"
                className="btn-mic-pill"
                title="Voice transcription (synthetic demo)"
                onClick={() => alert('Voice input active. Speak your investigative query.')}
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" y1="19" x2="12" y2="22" />
                </svg>
              </button>

              {/* Blue Circular Send Pill Button matching user image */}
              <button
                type="submit"
                className="btn-send-blue"
                disabled={!inputPrompt.trim() || aiGenerating}
                title="Send message"
              >
                <svg
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="12" y1="19" x2="12" y2="5" />
                  <polyline points="5 12 12 5 19 12" />
                </svg>
              </button>
            </div>
          </form>

          <p className="chat-disclaimer-subtext">
            CaseMind OS can make mistakes. Verify important factual evidence against original audit records.
          </p>
        </footer>
      )}

      {/* Modals */}
      {activeCase && (
        <>
          <EvidenceModal
            caseId={activeCase._id}
            isOpen={showEvidenceModal}
            onClose={() => setShowEvidenceModal(false)}
            onEvidenceAdded={() => {
              // Evidence added
            }}
          />
          <MemoryModal
            caseId={activeCase._id}
            isOpen={showMemoryModal}
            onClose={() => setShowMemoryModal(false)}
            onEvidenceClick={handleCitationClick}
          />
          <ReportModal
            caseId={activeCase._id}
            isOpen={showReportModal}
            onClose={() => setShowReportModal(false)}
            onEvidenceClick={handleCitationClick}
          />
        </>
      )}
    </main>
  );
}
