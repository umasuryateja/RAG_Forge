import React, { useState, useEffect, useRef } from "react";
import axios from "axios";
import {
  MessageSquare,
  UploadCloud,
  Trash2,
  Loader2,
  Sun,
  Moon,
  Send,
  FileText,
  Sparkles,
  Eye,
  ChevronRight,
  Search,
  Copy,
  Check,
  Paperclip,
  Plus,
  Clock,
  HardDrive,
  File,
  Menu,
  X,
  Pencil,
  MoreVertical,
  User,
  ChevronDown,
  LogOut,
  Info
} from "lucide-react";

const BACKEND_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const API_BASE = `${BACKEND_URL}/api/v1`;

// Custom Markdown Inline Formatter
const formatInline = (text) => {
  let formatted = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  
  // Format bold (**text**)
  formatted = formatted.replace(/\*\*([\s\S]*?)\*\*/g, "<strong>$1</strong>");
  
  // Format inline code (`code`)
  formatted = formatted.replace(/`([^`]+)`/g, "<code class='inline-code'>$1</code>");
  
  return formatted;
};

// Custom Code Syntax Highlighter
const highlightCode = (code, language) => {
  let escaped = code;
  const keywords = /\b(def|class|return|import|from|as|print|const|let|var|function|if|else|for|while|try|except|catch|finally|async|await|default|export|import|new|this|class|interface|type|extends|implements|public|private|protected|static|readonly|string|number|boolean|any|void|null|undefined|true|false)\b/g;
  
  // Wrap keywords in styling span
  escaped = escaped.replace(keywords, "<span class='text-indigo-400 font-semibold'>$1</span>");
  
  // Highlight comments
  escaped = escaped.replace(/(#.*|\/\/.*)/g, "<span class='text-slate-500 italic'>$1</span>");
  
  // Highlight strings
  escaped = escaped.replace(/(['"`][^'"`]*['"`])/g, "<span class='text-emerald-400'>$1</span>");
  
  return escaped;
};

function App() {
  // Navigation & UI States
  const [activeTab, setActiveTab] = useState("chat"); // chat is the main focus
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [toasts, setToasts] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Documents State
  const [documents, setDocuments] = useState([]);
  const [isLoadingDocs, setIsLoadingDocs] = useState(false);
  const [selectedDocument, setSelectedDocument] = useState(null); // for Details Preview modal
  const [selectedCitation, setSelectedCitation] = useState(null); // for Source Citation Preview modal

  // Chat State
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [currentStreamText, setCurrentStreamText] = useState("");
  const [currentCitations, setCurrentCitations] = useState([]);
  
  const chatBottomRef = useRef(null);
  const chatFileInputRef = useRef(null);
  const dashboardFileInputRef = useRef(null);
  const docsFileInputRef = useRef(null);

  // Drag and Drop State
  const [isDragging, setIsDragging] = useState(false);

  // Chat Memory & Persistency States
  const [conversations, setConversations] = useState(() => {
    try {
      const saved = localStorage.getItem("ragforge_conversations");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const [activeConversationId, setActiveConversationId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [docToDelete, setDocToDelete] = useState(null);

  // Auto-sync conversations to LocalStorage
  useEffect(() => {
    localStorage.setItem("ragforge_conversations", JSON.stringify(conversations));
  }, [conversations]);

  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [convToDelete, setConvToDelete] = useState(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  // Modal Visibility States
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [clearAllConfirmOpen, setClearAllConfirmOpen] = useState(false);
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false);
  const [aboutModalOpen, setAboutModalOpen] = useState(false);

  // Close dropdown menu and user menu when clicking outside
  useEffect(() => {
    const handleGlobalClick = () => {
      setActiveDropdownId(null);
      setUserMenuOpen(false);
    };
    window.addEventListener("click", handleGlobalClick);
    return () => {
      window.removeEventListener("click", handleGlobalClick);
    };
  }, []);

  // Global keypress listener for Escape key to close active modals
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        setProfileModalOpen(false);
        setClearAllConfirmOpen(false);
        setLogoutConfirmOpen(false);
        setAboutModalOpen(false);
        setDocToDelete(null);
        setConvToDelete(null);
        setSelectedDocument(null);
        setSelectedCitation(null);
        setActiveDropdownId(null);
        setUserMenuOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  // Settings State (loaded from backend for execution config but hidden from UI)
  const [settings, setSettings] = useState({
    gemini_api_key: "",
    gemini_model: "gemini-1.5-flash",
    temperature: 0.2,
    top_k: 3,
    chunk_size: 800,
    chunk_overlap: 150,
    system_instruction: ""
  });

  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // Toast Helper
  const addToast = (message, type = "success") => {
    const id = Date.now();
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  };



  // Fetch Documents List
  const fetchDocs = async () => {
    setIsLoadingDocs(true);
    try {
      const docsRes = await axios.get(`${API_BASE}/documents`);
      if (docsRes.data.success) {
        setDocuments(docsRes.data.data);
      }
    } catch (err) {
      console.error("Docs load failure:", err);
      addToast("Failed to fetch documents list.", "error");
    } finally {
      setIsLoadingDocs(false);
    }
  };

  // Load Settings from Server
  const fetchSettings = async () => {
    try {
      const res = await axios.get(`${API_BASE}/settings`);
      if (res.data.success) {
        setSettings(res.data.data);
      }
    } catch (err) {
      console.error("Settings load failure:", err);
    }
  };

  useEffect(() => {
    fetchDocs();
    fetchSettings();
  }, []);

  // Scroll to Chat Bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMessages, currentStreamText]);

  // Select Conversation from Sidebar
  const handleSelectConv = (id) => {
    const conv = conversations.find((c) => c.id === id);
    if (conv) {
      setActiveConversationId(id);
      setChatMessages(conv.messages);
      setCurrentStreamText("");
      setCurrentCitations([]);
      setActiveTab("chat");
    }
  };

  // Start Renaming Chat
  const handleStartRename = (e, id, currentTitle) => {
    e.stopPropagation();
    setEditingId(id);
    setEditingTitle(currentTitle);
  };

  // Save Renamed Title
  const handleSaveRename = (id) => {
    if (editingTitle.trim()) {
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, title: editingTitle.trim() } : c))
      );
    }
    setEditingId(null);
  };

  // Delete Conversation
  const handleDeleteConv = (e, id) => {
    e.stopPropagation();
    if (window.confirm("Are you sure you want to delete this conversation?")) {
      setConversations((prev) => prev.filter((c) => c.id !== id));
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setChatMessages([]);
      }
    }
  };

  // Clear All Chats
  const handleClearAllChats = () => {
    if (window.confirm("Are you sure you want to clear all conversations?")) {
      setConversations([]);
      setActiveConversationId(null);
      setChatMessages([]);
      localStorage.removeItem("ragforge_conversations");
      addToast("All conversations cleared.", "success");
    }
  };

  // Memoize sorted conversations list
  const sortedConversations = React.useMemo(() => {
    return [...conversations].sort((a, b) => {
      const timeA = a.updatedAt || a.createdAt;
      const timeB = b.updatedAt || b.createdAt;
      return timeB - timeA;
    });
  }, [conversations]);

  // Group Conversations chronologically based on latest update
  const groupConversations = (list) => {
    const today = [];
    const yesterday = [];
    const last7Days = [];
    const last30Days = [];
    const older = [];

    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;
    const startOf7Days = startOfToday - 6 * 24 * 60 * 60 * 1000;
    const startOf30Days = startOfToday - 29 * 24 * 60 * 60 * 1000;

    list.forEach((c) => {
      const t = c.updatedAt || c.createdAt;
      if (t >= startOfToday) {
        today.push(c);
      } else if (t >= startOfYesterday) {
        yesterday.push(c);
      } else if (t >= startOf7Days) {
        last7Days.push(c);
      } else if (t >= startOf30Days) {
        last30Days.push(c);
      } else {
        older.push(c);
      }
    });

    return { today, yesterday, last7Days, last30Days, older };
  };

  // Trigger Document Deletion backend call
  const executeDeleteDoc = async (filename) => {
    try {
      const res = await axios.delete(`${API_BASE}/documents/${encodeURIComponent(filename)}`);
      if (res.data.success) {
        addToast(res.data.message, "success");
        setDocuments((prev) => prev.filter((doc) => doc.filename !== filename));
        fetchDocs(); // Sync with backend state instantly
      } else {
        addToast(res.data.message || "Failed to delete document.", "error");
      }
    } catch (err) {
      console.error("Delete failure:", err);
      addToast("Delete request failed.", "error");
    }
  };

  // Handle File Upload Process
  const handleUploadFile = async (file) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      addToast("Only PDF documents are supported.", "error");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    setIsUploading(true);
    setUploadProgress(20);

    try {
      const res = await axios.post(`${API_BASE}/documents/upload`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (progressEvent) => {
          const pct = Math.round((progressEvent.loaded * 100) / progressEvent.total);
          setUploadProgress(20 + Math.round(pct * 0.7));
        }
      });

      setUploadProgress(100);
      if (res.data.success) {
        addToast(`Successfully analyzed "${file.name}"!`, "success");
        fetchDocs();
      } else {
        addToast(res.data.message || "Failed to parse document.", "error");
      }
    } catch (err) {
      console.error("Upload failure:", err);
      const errMsg = err.response?.data?.detail || "Connection failure during document analysis.";
      addToast(errMsg, "error");
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
    }
  };

  // File Picker Handlers
  const triggerFileInput = (ref) => {
    ref.current?.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) handleUploadFile(file);
  };

  // Drag and Drop Events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleUploadFile(file);
  };

  // Handle Chat SSE Streaming
  const handleSendChat = async (e, customInput = null) => {
    if (e) e.preventDefault();
    
    const queryText = customInput || chatInput.trim();
    if (!queryText) return;
    if (isGenerating) return;

    setChatInput("");
    setIsGenerating(true);
    setCurrentStreamText("");
    setCurrentCitations([]);

    let convId = activeConversationId;
    let updatedMessages = [];

    // If new conversation, generate entry
    if (!convId) {
      convId = "conv-" + Date.now();
      setActiveConversationId(convId);
      
      const userMsg = { role: "user", text: queryText, citations: null };
      updatedMessages = [userMsg];
      setChatMessages(updatedMessages);

      const newConv = {
        id: convId,
        title: queryText.substring(0, 30) + (queryText.length > 30 ? "..." : ""),
        createdAt: Date.now(),
        messages: updatedMessages
      };
      setConversations((prev) => [newConv, ...prev]);
    } else {
      const userMsg = { role: "user", text: queryText, citations: null };
      updatedMessages = [...chatMessages, userMsg];
      setChatMessages(updatedMessages);

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: updatedMessages } : c))
      );
    }

    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: queryText, top_k: settings.top_k })
      });

      if (!response.ok) {
        throw new Error(`Server status HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let accumulatedText = "";
      let currentCitationsList = [];

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.trim().startsWith("data: ")) {
            const dataStr = line.trim().slice(6);
            try {
              const payload = JSON.parse(dataStr);
              if (payload.type === "citations") {
                currentCitationsList = payload.content;
                setCurrentCitations(payload.content);
              } else if (payload.type === "text") {
                accumulatedText += payload.content;
                setCurrentStreamText((prev) => prev + payload.content);
              } else if (payload.type === "error") {
                addToast(payload.content, "error");
                accumulatedText += `\n\n[Error: ${payload.content}]`;
                setCurrentStreamText((prev) => prev + `\n\n[Error: ${payload.content}]`);
              } else if (payload.type === "metrics") {
                console.log("RAG Pipeline Timing Metrics:", payload.content);
              }
            } catch (jsonErr) {
              console.error("JSON parse failure:", jsonErr);
            }
          }
        }
      }

      // Append completed assistant log
      const assistantMsg = {
        role: "assistant",
        text: accumulatedText || "No response received from the RAG service backend.",
        citations: currentCitationsList.length > 0 ? currentCitationsList : null
      };

      const finalMessages = [...updatedMessages, assistantMsg];
      setChatMessages(finalMessages);

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: finalMessages } : c))
      );
      setCurrentStreamText("");
      setCurrentCitations([]);

    } catch (streamErr) {
      console.error("Streaming failure:", streamErr);
      addToast("Failed to compile assistant response.", "error");
      
      const assistantMsg = {
        role: "assistant",
        text: `Connection failed: ${streamErr.message}. Ensure your AI model is active and running.`,
        citations: null
      };

      const finalMessages = [...updatedMessages, assistantMsg];
      setChatMessages(finalMessages);

      setConversations((prev) =>
        prev.map((c) => (c.id === convId ? { ...c, messages: finalMessages } : c))
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const handlePresetPrompt = (promptText) => {
    if (isGenerating) return;
    setActiveTab("chat");
    handleSendChat(null, promptText);
  };

  const handleCopyMessage = (text, idx) => {
    navigator.clipboard.writeText(text);
    setCopiedId(idx);
    setTimeout(() => setCopiedId(null), 2000);
  };



  const filteredDocuments = React.useMemo(() => {
    return documents.filter((doc) =>
      doc.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [documents, searchQuery]);

  return (
    <div className={`min-h-screen flex ${isDarkMode ? "bg-[#06080e] text-[#f3f4f6]" : "bg-[#f8fafc] text-[#0f172a]"} transition-colors duration-300 overflow-hidden`}>
      
      {/* Sidebar Overlay (Mobile) */}
      {sidebarOpen && (
        <div 
          onClick={() => setSidebarOpen(false)} 
          className="fixed inset-0 bg-black/60 z-30 md:hidden animate-fade-in"
        />
      )}

      {/* Sidebar Navigation */}
      {/* Sidebar Navigation */}
      <aside className={`fixed md:relative top-0 bottom-0 left-0 w-64 flex-shrink-0 flex flex-col justify-between p-5 ${
        isDarkMode ? "bg-[#0c0f18] border-r border-[#151c2d]" : "bg-white border-r border-slate-200"
      } shadow-xl z-40 transition-transform duration-300 md:translate-x-0 ${
        sidebarOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      }`}>
        <div className="flex flex-col flex-1 min-h-0">
          {/* Header Branding */}
          <div className="flex items-center justify-between mb-6 mt-1 flex-shrink-0">
            <div className="flex items-center gap-3">
              <div className="bg-gradient-to-tr from-indigo-600 to-violet-600 p-2 rounded-xl text-white shadow-lg shadow-indigo-600/30">
                <Sparkles className="h-4.5 w-4.5" />
              </div>
              <div>
                <h2 className="text-base font-bold tracking-tight font-display bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent">RAGForge</h2>
                <span className="text-[8.5px] text-indigo-400 font-mono tracking-widest uppercase font-semibold">AI Assistant</span>
              </div>
            </div>
            <button 
              onClick={() => setSidebarOpen(false)}
              className="p-1.5 rounded-lg hover:bg-white/5 md:hidden cursor-pointer text-slate-400 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* New Chat Button */}
          <button
            onClick={() => {
              setActiveConversationId(null);
              setChatMessages([]);
              setCurrentStreamText("");
              setCurrentCitations([]);
              setActiveTab("chat");
              setSidebarOpen(false);
            }}
            className="w-full mb-2.5 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-indigo-500/20 bg-indigo-600/10 text-indigo-400 hover:bg-indigo-600 hover:text-white transition-all text-xs font-semibold cursor-pointer shadow-sm flex-shrink-0"
          >
            <Plus className="h-4 w-4" />
            <span>New Chat</span>
          </button>

          {/* Documents Navigation Button */}
          <button
            onClick={() => {
              setActiveTab("documents");
              setSidebarOpen(false);
            }}
            className={`w-full mb-4 flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all duration-200 text-xs font-semibold cursor-pointer flex-shrink-0 ${
              activeTab === "documents"
                ? "bg-indigo-500/15 text-white border-l-2 border-indigo-500 rounded-r-xl rounded-l-none font-bold"
                : isDarkMode
                ? "text-slate-400 hover:bg-[#121826] hover:text-slate-200"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <FileText className="h-4 w-4 text-indigo-400" />
            <span>📄 Documents</span>
          </button>
 
          {/* Chat History Grouping */}
          <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin min-h-0">
            {conversations.length === 0 ? (
              <div className="text-[11px] text-slate-500 italic pl-3 pt-2">No recent chats</div>
            ) : (
              Object.entries(groupConversations(sortedConversations)).map(([groupKey, groupItems]) => {
                if (groupItems.length === 0) return null;
                const groupLabels = {
                  today: "Today",
                  yesterday: "Yesterday",
                  last7Days: "Last 7 Days",
                  last30Days: "Last 30 Days",
                  older: "Older"
                };
                return (
                  <div key={groupKey} className="space-y-1">
                    <span className="text-[9.5px] text-slate-500 font-bold tracking-wider uppercase pl-2.5">{groupLabels[groupKey]}</span>
                    <div className="space-y-0.5 font-sans">
                      {groupItems.map((c) => (
                        <div
                          key={c.id}
                          onClick={() => handleSelectConv(c.id)}
                          className={`group/item w-full flex items-center justify-between px-3 py-2 rounded-xl text-[11.5px] font-medium transition-all cursor-pointer relative ${
                            activeConversationId === c.id
                              ? "bg-indigo-500/10 text-white font-semibold border-l-2 border-indigo-500 rounded-r-xl rounded-l-none"
                              : isDarkMode
                              ? "text-slate-400 hover:bg-[#121826] hover:text-slate-200"
                              : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <MessageSquare className="h-3.5 w-3.5 flex-shrink-0 text-indigo-400 group-hover:text-indigo-300" />
                            {editingId === c.id ? (
                              <input
                                type="text"
                                value={editingTitle}
                                onChange={(e) => setEditingTitle(e.target.value)}
                                onBlur={() => handleSaveRename(c.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    handleSaveRename(c.id);
                                  } else if (e.key === "Escape") {
                                    setEditingId(null);
                                  }
                                }}
                                onClick={(e) => e.stopPropagation()}
                                autoFocus
                                className="bg-slate-950 border border-indigo-500 rounded px-1.5 py-0.5 text-white w-full focus:outline-none"
                              />
                            ) : (
                              <span className="truncate pr-1">{c.title}</span>
                            )}
                          </div>
                          
                          {editingId !== c.id && (
                            <div className="opacity-0 group-hover/item:opacity-100 flex items-center gap-1.5 relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setActiveDropdownId(prev => prev === c.id ? null : c.id);
                                }}
                                className="p-1 hover:bg-white/10 rounded transition-colors"
                                title="Chat actions"
                              >
                                <MoreVertical className="h-3.5 w-3.5" />
                              </button>

                              {/* Action Dropdown Menu */}
                              {activeDropdownId === c.id && (
                                <div className="absolute right-0 top-6 z-50 w-36 rounded-xl border border-slate-800 bg-[#0c0f18] p-1 shadow-xl animate-fade-in font-sans">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveDropdownId(null);
                                      handleStartRename(e, c.id, c.title);
                                    }}
                                    className="w-full text-left px-3 py-2 text-[11px] rounded-lg hover:bg-slate-800 text-slate-300 flex items-center gap-2 transition-colors cursor-pointer"
                                  >
                                    <Pencil className="h-3 w-3 text-indigo-400" />
                                    <span>Rename Chat</span>
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveDropdownId(null);
                                      setConvToDelete(c.id);
                                    }}
                                    className="w-full text-left px-3 py-2 text-[11px] rounded-lg hover:bg-rose-500/10 hover:text-rose-400 text-rose-500 flex items-center gap-2 transition-colors cursor-pointer"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                    <span>Delete Chat</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Footer - Profile Block */}
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800 relative font-sans flex-shrink-0">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setUserMenuOpen(!userMenuOpen);
            }}
            className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl hover:bg-slate-800/40 transition-colors text-xs font-semibold text-slate-300 hover:text-white cursor-pointer select-none"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-6.5 h-6.5 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-[10.5px] border border-indigo-500/15 font-sans">
                👤
              </div>
              <span className="truncate text-[11.5px]">Uma Surya Teja</span>
            </div>
            <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${userMenuOpen ? "rotate-180" : ""}`} />
          </button>

          {/* User Menu Dropdown */}
          {userMenuOpen && (
            <div className="absolute bottom-14 left-0 right-0 z-50 rounded-xl border border-slate-800 bg-[#0c0f18] p-1 shadow-2xl animate-fade-in text-[11px] text-slate-300">
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setProfileModalOpen(true);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <User className="h-3.5 w-3.5 text-indigo-400" />
                <span>Profile</span>
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setClearAllConfirmOpen(true);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-rose-500/10 hover:text-rose-400 text-rose-500 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Clear All Chats</span>
              </button>
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setLogoutConfirmOpen(true);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer"
              >
                <LogOut className="h-3.5 w-3.5 text-slate-500" />
                <span>Logout</span>
              </button>
              <div className="border-t border-slate-800/60 my-1" />
              <button
                onClick={() => {
                  setUserMenuOpen(false);
                  setAboutModalOpen(true);
                }}
                className="w-full text-left px-3 py-2 rounded-lg hover:bg-slate-800 flex items-center gap-2 transition-colors cursor-pointer text-slate-400"
              >
                <Info className="h-3.5 w-3.5 text-indigo-400" />
                <span>About RAGForge</span>
              </button>
            </div>
          )}
        </div>
      </aside>

      {/* Main Container */}
      <main className="flex-1 flex flex-col h-screen overflow-hidden">
        {/* Top Header Bar */}
        <header className={`h-16 flex items-center justify-between px-6 md:px-8 border-b ${isDarkMode ? "bg-[#090c13]/80 border-[#151c2d]" : "bg-white/80 border-slate-200"} backdrop-blur z-10`}>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 rounded-xl hover:bg-slate-800/40 md:hidden cursor-pointer text-slate-300"
            >
              <Menu className="h-4.5 w-4.5" />
            </button>
            <h1 className="text-sm font-bold font-display tracking-tight text-slate-200">
              {activeTab === "chat" 
                ? (conversations.find(c => c.id === activeConversationId)?.title || "New Chat") 
                : "Documents Hub"}
            </h1>
          </div>
          
          <div className="flex items-center gap-3">
            {isUploading && (
              <div className="flex items-center gap-2 text-xs font-medium text-indigo-400 bg-indigo-500/10 px-3 py-1.5 rounded-xl border border-indigo-500/15">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Indexing: {uploadProgress}%</span>
              </div>
            )}
          </div>
        </header>

        {/* Dynamic View Layout */}
        <div className="flex-1 overflow-hidden p-4 md:p-6 relative flex flex-col">
          


          {/* TAB 2: CHAT VIEW */}
          {activeTab === "chat" && (
            <div className="max-w-4xl mx-auto w-full flex flex-col flex-1 overflow-hidden animate-slide-up">
              
              {/* Messages viewport */}
              <div className={`flex-1 overflow-y-auto p-6 space-y-6 rounded-2xl ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} mb-4 relative`}>
                
                {/* Empty State */}
                {chatMessages.length === 0 && (
                  <div className="flex flex-col items-center justify-center min-h-full py-12 px-4 text-center animate-slide-up">
                    <div className="w-12 h-12 rounded-2xl bg-indigo-600/10 flex items-center justify-center text-indigo-400 mb-6 border border-indigo-500/15">
                      <Sparkles className="h-5 w-5 animate-pulse" />
                    </div>
                    <h3 className="text-xl font-bold font-display text-slate-100 tracking-tight">How can I help you today?</h3>
                    <p className="text-xs text-slate-400 max-w-sm mt-2 mb-8 leading-relaxed">
                      Ask questions or request insights. Your Enterprise AI Knowledge Assistant will answer strictly based on your ingested documents.
                    </p>
                    
                    {/* Suggested preset prompts */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-2xl mt-4">
                      <button
                        onClick={() => handlePresetPrompt("Provide a summary of the key findings in the uploaded documents.")}
                        className={`p-4 rounded-xl border text-left text-xs transition-all duration-200 hover:scale-[1.01] hover:border-indigo-500/30 cursor-pointer ${
                          isDarkMode ? "bg-[#0a0c13]/60 border-[#151c2d] hover:bg-[#121826]/80 text-slate-300" : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <span className="font-semibold text-indigo-400 block mb-1">Quick Summary</span>
                        "Summarize the key findings of my uploaded documents..."
                      </button>
                      <button
                        onClick={() => handlePresetPrompt("Identify the primary goals and methodologies outlined in the text.")}
                        className={`p-4 rounded-xl border text-left text-xs transition-all duration-200 hover:scale-[1.01] hover:border-indigo-500/30 cursor-pointer ${
                          isDarkMode ? "bg-[#0a0c13]/60 border-[#151c2d] hover:bg-[#121826]/80 text-slate-300" : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <span className="font-semibold text-indigo-400 block mb-1">Methodology Insights</span>
                        "Identify the primary goals and methodologies..."
                      </button>
                      <button
                        onClick={() => handlePresetPrompt("Analyze and compare the differences between the uploaded documents.")}
                        className={`p-4 rounded-xl border text-left text-xs transition-all duration-200 hover:scale-[1.01] hover:border-indigo-500/30 cursor-pointer ${
                          isDarkMode ? "bg-[#0a0c13]/60 border-[#151c2d] hover:bg-[#121826]/80 text-slate-300" : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <span className="font-semibold text-indigo-400 block mb-1">Compare Documents</span>
                        "Analyze the differences between the uploaded reports..."
                      </button>
                      <button
                        onClick={() => handlePresetPrompt("Extract definitions, formulas, and key metrics from the documents.")}
                        className={`p-4 rounded-xl border text-left text-xs transition-all duration-200 hover:scale-[1.01] hover:border-indigo-500/30 cursor-pointer ${
                          isDarkMode ? "bg-[#0a0c13]/60 border-[#151c2d] hover:bg-[#121826]/80 text-slate-300" : "bg-slate-50 border-slate-200 hover:bg-slate-100 text-slate-700"
                        }`}
                      >
                        <span className="font-semibold text-indigo-400 block mb-1">Key Extraction</span>
                        "Extract the main definitions and key performance indicators..."
                      </button>
                    </div>
                  </div>
                )}

                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex flex-col w-full ${msg.role === "user" ? "items-end" : "items-start"}`}
                  >
                    <div className="flex items-start gap-3 max-w-[85%]">
                      {msg.role === "assistant" && (
                        <div className="w-8 h-8 rounded-lg bg-indigo-600/10 flex items-center justify-center text-indigo-400 border border-indigo-500/15 flex-shrink-0 mt-0.5">
                          <Sparkles className="h-4 w-4" />
                        </div>
                      )}
                      
                      <div className="flex-1">
                        <div className={`p-4 rounded-2xl text-xs leading-relaxed relative group ${
                          msg.role === "user"
                            ? "bg-indigo-600 text-white rounded-tr-none shadow-md shadow-indigo-600/10"
                            : isDarkMode
                            ? "bg-[#111624] border border-[#151c2d] text-slate-200 rounded-tl-none"
                            : "bg-slate-100 border border-slate-200 text-slate-800 rounded-tl-none"
                        }`}>
                          {msg.role === "assistant" ? (
                            <div className="font-sans break-words">{renderMessageContent(msg.text)}</div>
                          ) : (
                            <p className="whitespace-pre-wrap font-sans break-words">{msg.text}</p>
                          )}

                          {/* Copy button on response hover */}
                          {msg.role === "assistant" && (
                            <button
                              onClick={() => handleCopyMessage(msg.text, idx)}
                              className="absolute top-2 right-2 p-1 rounded-lg bg-slate-900/40 text-slate-400 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                              title="Copy response"
                            >
                              {copiedId === idx ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                            </button>
                          )}
                        </div>

                        {/* Collapsible Citations References */}
                        {msg.citations && msg.citations.length > 0 && (
                          <div className="mt-4 border-t border-slate-800/40 pt-3 space-y-2 select-none font-sans">
                            <div className="text-[11px] font-semibold text-slate-400">📄 Sources</div>
                            <div className="flex flex-col gap-1 pl-2">
                              {Array.from(new Set(msg.citations.map((c) => c.filename))).map((filename, fIdx) => (
                                <span key={fIdx} className="text-[11px] text-slate-300 font-medium">
                                  {filename}
                                </span>
                              ))}
                            </div>
                            
                            <details className="group mt-2">
                              <summary className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 transition-colors font-semibold cursor-pointer list-none pl-2">
                                <span>View Details</span>
                                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90 text-indigo-400" />
                              </summary>
                              
                              <div className="mt-2.5 pl-3 border-l border-indigo-500/20 space-y-3 animate-fade-in max-h-60 overflow-y-auto custom-scrollbar">
                                {msg.citations.map((cit, cIdx) => (
                                  <div key={cIdx} className="text-[11px] bg-slate-900/30 p-2.5 rounded-xl border border-white/5 space-y-1.5 font-sans">
                                    <div className="flex items-center justify-between text-slate-400">
                                      <span className="font-semibold text-slate-200">{cit.filename}</span>
                                      <span className="text-[9.5px] font-mono bg-indigo-500/10 text-indigo-400 px-1.5 py-0.2 rounded font-bold">
                                        Page {cit.pages && cit.pages.length > 0 ? cit.pages.join(", ") : "N/A"}
                                      </span>
                                    </div>
                                    <p className="text-[10.5px] text-slate-300 leading-relaxed italic bg-slate-950/40 p-2 rounded-lg whitespace-pre-wrap">
                                      {cit.preview.endsWith("...") ? cit.preview.slice(0, -3) : cit.preview}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </details>
                          </div>
                        )}

                        {/* Suggested Follow-up Questions */}
                        {msg.role === "assistant" && idx === chatMessages.length - 1 && !isGenerating && (
                          <div className="mt-4 flex flex-col gap-1.5">
                            <span className="text-[10px] text-slate-500 font-semibold tracking-wider uppercase pl-1.5">Suggested Questions</span>
                            <div className="flex flex-wrap gap-1.5">
                              {getFollowUpQuestions(msg).map((question, qIdx) => (
                                <button
                                  key={qIdx}
                                  onClick={() => handlePresetPrompt(question)}
                                  className={`px-3 py-1.5 rounded-xl border text-[10.5px] text-left transition-all cursor-pointer hover:border-indigo-500/30 ${
                                    isDarkMode ? "bg-[#0a0c13] border-[#151c2d] text-slate-400 hover:text-slate-200" : "bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100"
                                  }`}
                                >
                                  {question}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                ))}

                {/* Streaming indicators */}
                {isGenerating && (currentStreamText || currentCitations.length > 0) && (
                  <div className="flex flex-col items-start w-full">
                    <div className="flex items-start gap-3 max-w-[85%]">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600/10 flex items-center justify-center text-indigo-400 border border-indigo-500/15 flex-shrink-0 mt-0.5">
                        <Sparkles className="h-4 w-4" />
                      </div>
                      <div className="flex-1">
                        {currentStreamText && (
                          <div className={`p-4 rounded-2xl text-xs leading-relaxed rounded-tl-none ${
                            isDarkMode ? "bg-[#111624] border border-[#151c2d] text-slate-200" : "bg-slate-100 border border-slate-200 text-slate-800"
                          }`}>
                             <div className="font-sans break-words">{renderMessageContent(currentStreamText)}</div>
                          </div>
                        )}

                        {/* Collapsible Citations References during stream */}
                        {currentCitations && currentCitations.length > 0 && (
                          <div className="mt-4 border-t border-slate-800/40 pt-3 space-y-2 select-none font-sans">
                            <div className="text-[11px] font-semibold text-slate-400">📄 Sources</div>
                            <div className="flex flex-col gap-1 pl-2">
                              {Array.from(new Set(currentCitations.map((c) => c.filename))).map((filename, fIdx) => (
                                <span key={fIdx} className="text-[11px] text-slate-300 font-medium">
                                  {filename}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Premium thinking / skeleton loader state */}
                {isGenerating && !currentStreamText && (
                  <div className="w-full flex items-start gap-3 animate-pulse ml-0 md:ml-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600/10 flex items-center justify-center text-indigo-400 border border-indigo-500/15 flex-shrink-0 mt-0.5">
                      <Sparkles className="h-4 w-4 text-indigo-400 font-bold" />
                    </div>
                    <div className="flex-1 space-y-3 max-w-xl">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-indigo-400 font-mono tracking-wider uppercase font-semibold">Retrieving context & synthesizing response...</span>
                        <Loader2 className="h-3 w-3 animate-spin text-indigo-500" />
                      </div>
                      <div className={`p-4 rounded-2xl border ${isDarkMode ? "bg-[#111624] border-[#151c2d]" : "bg-slate-100 border-slate-200"} rounded-tl-none space-y-2.5`}>
                        <div className="h-2 bg-slate-700/40 dark:bg-slate-700/20 rounded-lg w-11/12" />
                        <div className="h-2 bg-slate-700/40 dark:bg-slate-700/20 rounded-lg w-5/6" />
                        <div className="h-2 bg-slate-700/40 dark:bg-slate-700/20 rounded-lg w-2/3" />
                      </div>
                    </div>
                  </div>
                )}

                <div ref={chatBottomRef} />
              </div>

              {/* Chat send input box */}
              <form onSubmit={(e) => handleSendChat(e)} className="flex gap-2">
                <div className="flex-1 relative flex items-center">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Ask questions about your uploaded documents..."
                    disabled={isGenerating}
                    className={`w-full pl-5 pr-12 py-3.5 rounded-2xl border font-sans text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-all ${
                      isDarkMode
                        ? "bg-[#0c0f18] border-[#151c2d] text-slate-200 placeholder-slate-500"
                        : "bg-white border-slate-200 text-slate-800 placeholder-slate-400"
                    }`}
                  />
                  
                  {/* Attach PDF Shortcut */}
                  <input
                    type="file"
                    accept=".pdf"
                    ref={chatFileInputRef}
                    onChange={handleFileChange}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => triggerFileInput(chatFileInputRef)}
                    disabled={isGenerating || isUploading}
                    className="absolute right-4 text-slate-400 hover:text-indigo-400 transition-colors p-1 rounded hover:bg-white/5 cursor-pointer disabled:opacity-30"
                    title="Upload & Ingest PDF document"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </div>
                
                <button
                  type="submit"
                  disabled={isGenerating || !chatInput.trim()}
                  className="px-5 py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl flex items-center justify-center gap-1.5 shadow-lg shadow-indigo-600/20 hover:scale-[1.01] active:scale-[0.99] transition-all disabled:opacity-40 disabled:scale-100 disabled:pointer-events-none cursor-pointer"
                >
                  {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  <span className="font-semibold text-[10px] uppercase tracking-wider">Send</span>
                </button>
              </form>
            </div>
          )}

          {/* TAB 3: DOCUMENTS VIEW */}
          {activeTab === "documents" && (
            <div className="max-w-5xl mx-auto w-full space-y-6 animate-slide-up overflow-y-auto flex-1 pr-1">
              
              {/* Document Manager Controls */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="relative w-full sm:w-80">
                  <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search documents by name..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`w-full pl-9 pr-4 py-2.5 rounded-xl border text-xs focus:outline-none focus:ring-1 focus:ring-indigo-600 transition-all ${
                      isDarkMode
                        ? "bg-[#0c0f18] border-[#151c2d] text-slate-200 placeholder-slate-500"
                        : "bg-slate-50 border-slate-200 text-slate-800 placeholder-slate-400"
                    }`}
                  />
                </div>

                <input
                  type="file"
                  accept=".pdf"
                  ref={docsFileInputRef}
                  onChange={handleFileChange}
                  className="hidden"
                />
                <button
                  onClick={() => triggerFileInput(docsFileInputRef)}
                  disabled={isUploading}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 shadow-md shadow-indigo-600/25 transition-all cursor-pointer disabled:opacity-50"
                >
                  <Plus className="h-4 w-4" />
                  <span>Upload New Document</span>
                </button>
              </div>

              {/* Cards Grid Layout */}
              {isLoadingDocs ? (
                <div className="flex flex-col items-center justify-center py-20 gap-3">
                  <Loader2 className="h-8 w-8 text-indigo-500 animate-spin" />
                  <span className="text-xs text-slate-400">Loading documents from base...</span>
                </div>
              ) : filteredDocuments.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-24 border border-dashed border-slate-800 rounded-2xl">
                  <FileText className="h-10 w-10 text-slate-600 mb-3" />
                  <span className="text-sm font-semibold text-slate-400">No Documents Available</span>
                  <p className="text-xs text-slate-500 mt-1 max-w-xs text-center">
                    Upload documents to index them for conversational analysis.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredDocuments.map((doc, idx) => (
                    <div
                      key={idx}
                      className={`p-5 rounded-2xl border transition-all flex flex-col justify-between h-48 ${
                        isDarkMode
                          ? "bg-[#0c0f18] border-[#151c2d] hover:border-indigo-500/20"
                          : "bg-white border-slate-200 hover:border-indigo-500/30"
                      } shadow-sm`}
                    >
                      <div className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div className="p-2.5 bg-indigo-600/10 rounded-xl text-indigo-400">
                            <FileText className="h-5 w-5" />
                          </div>
                          
                          {/* File Size badge */}
                          <span className="text-[10px] font-mono bg-slate-800/60 dark:text-slate-400 text-slate-600 px-2 py-0.5 rounded-lg border border-white/5">
                            {doc.file_size_kb ? `${doc.file_size_kb} KB` : "N/A"}
                          </span>
                        </div>

                        <div>
                          <h4
                            className="text-xs font-bold text-slate-200 truncate w-full"
                            title={doc.filename}
                          >
                            {doc.filename}
                          </h4>
                          
                          {/* Upload Date details */}
                          <div className="flex items-center gap-1 text-[10px] text-slate-500 mt-1">
                            <Clock className="h-3 w-3" />
                            <span>Uploaded: {doc.upload_time.split(" ")[0]}</span>
                          </div>
                        </div>
                      </div>

                      {/* Card Bottom Row Info and Actions */}
                      <div className="flex items-center justify-between border-t border-slate-800/40 pt-3 mt-4">
                        <span className="text-[10.5px] text-slate-400 font-medium">
                          Pages: <span className="font-mono text-indigo-400 font-bold">{doc.page_count}</span>
                        </span>
                        
                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setSelectedDocument(doc)}
                            className="px-2.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg text-[10.5px] font-semibold transition-all cursor-pointer"
                          >
                            Preview
                          </button>
                          <button
                            onClick={() => setDocToDelete(doc.filename)}
                            className="p-1.5 text-rose-500 hover:bg-rose-500/15 rounded-lg transition-all cursor-pointer"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

        </div>
      </main>

      {/* MODAL 1: Document Details Preview Modal */}
      {selectedDocument && (
        <div className="fixed inset-0 bg-[#000]/70 flex items-center justify-center p-6 z-50 animate-fade-in">
          <div className={`w-full max-w-md rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} relative`}>
            
            <div className="flex items-center gap-3 mb-5">
              <div className="p-3 bg-indigo-600/10 rounded-2xl text-indigo-400 border border-indigo-500/15">
                <FileText className="h-6 w-6" />
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="text-sm font-bold text-slate-200 truncate">{selectedDocument.filename}</h4>
                <p className="text-[10px] text-slate-400 mt-0.5">Status: Ready for assistant search</p>
              </div>
            </div>

            <div className={`p-4 rounded-xl space-y-3 text-xs ${isDarkMode ? "bg-[#05070c]" : "bg-slate-50"} border border-white/5`}>
              <div className="flex justify-between">
                <span className="text-slate-400">File Name:</span>
                <span className="font-semibold text-slate-200 truncate max-w-[200px]">{selectedDocument.filename}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Date Uploaded:</span>
                <span className="font-semibold text-slate-200 font-mono">{selectedDocument.upload_time}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">File Size:</span>
                <span className="font-semibold text-slate-200 font-mono">{selectedDocument.file_size_kb} KB</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Number of Pages:</span>
                <span className="font-semibold text-slate-200 font-mono">{selectedDocument.page_count}</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setSelectedDocument(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Close View
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: Source Citation/Reference Details Preview */}
      {selectedCitation && (
        <div className="fixed inset-0 bg-[#000]/70 flex items-center justify-center p-6 z-50 animate-fade-in">
          <div className={`w-full max-w-2xl rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} relative`}>
            
            <div className="flex items-center justify-between border-b border-slate-800/60 pb-3.5 mb-4">
              <div>
                <h4 className="text-sm font-bold text-indigo-400">Document Reference Preview</h4>
                <p className="text-[10px] text-slate-400 mt-0.5 truncate max-w-[320px]">{selectedCitation.filename}</p>
              </div>
              
              {/* Match quality metrics (Relevance Match) */}
              <span className="text-[10px] bg-indigo-500/10 text-indigo-400 px-2.5 py-0.5 rounded-lg font-bold font-mono border border-indigo-500/15">
                {Math.round(selectedCitation.score * 100)}% Match Relevance
              </span>
            </div>
            
            {/* Clean preview box */}
            <div className={`p-4 rounded-xl max-h-[300px] overflow-y-auto text-xs leading-relaxed text-slate-300 font-mono whitespace-pre-wrap ${
              isDarkMode ? "bg-[#05070c]" : "bg-slate-50"
            } border border-white/5`}>
              {selectedCitation.preview.endsWith("...") ? selectedCitation.preview.slice(0, -3) : selectedCitation.preview}
              
              <span className="text-[10px] text-slate-500 italic block mt-4 border-t border-slate-800/40 pt-2 font-sans">
                Note: This text segment was retrieved from the document database dynamically based on query similarity.
              </span>
            </div>

            <div className="mt-5 flex justify-end">
              <button
                onClick={() => setSelectedCitation(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom modal dialog for permanent file deletion confirmation */}
      {docToDelete && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl`}>
            <h3 className="text-base font-bold text-slate-100 mb-2">Delete Document?</h3>
            <p className="text-xs text-slate-400 mb-3 leading-relaxed">
              This will permanently remove:
            </p>
            <ul className="list-disc pl-5 mb-4 space-y-1 text-xs text-slate-300">
              <li>PDF</li>
              <li>Embeddings</li>
              <li>Search Index</li>
            </ul>
            <p className="text-xs text-slate-400 mb-6 font-semibold">
              This action cannot be undone.
            </p>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDocToDelete(null)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer ${
                  isDarkMode ? "text-slate-400" : "text-slate-600 bg-slate-100 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const filename = docToDelete;
                  setDocToDelete(null);
                  await executeDeleteDoc(filename);
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom modal dialog for permanent conversation deletion confirmation */}
      {convToDelete && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in font-sans">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl`}>
            <h3 className="text-base font-bold text-slate-100 mb-2">Delete Conversation?</h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              This will permanently delete this conversation.
            </p>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setConvToDelete(null)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer ${
                  isDarkMode ? "text-slate-400" : "text-slate-600 bg-slate-100 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  const id = convToDelete;
                  setConvToDelete(null);
                  setConversations((prev) => prev.filter((c) => c.id !== id));
                  if (activeConversationId === id) {
                    setActiveConversationId(null);
                    setChatMessages([]);
                  }
                  addToast("Conversation deleted successfully.", "success");
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: Profile Modal */}
      {profileModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in font-sans">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl relative`}>
            <h3 className="text-base font-bold text-slate-100 mb-4 flex items-center gap-2">
              <User className="h-4.5 w-4.5 text-indigo-400" />
              <span>User Profile</span>
            </h3>
            
            <div className="flex flex-col items-center justify-center mb-5 border-b border-slate-800/40 pb-5">
              <div className="w-16 h-16 rounded-full bg-indigo-500/10 text-indigo-400 flex items-center justify-center font-bold text-lg border-2 border-indigo-500/30 mb-3 font-sans">
                👤
              </div>
              <h4 className="text-sm font-bold text-slate-200">Uma Surya Teja</h4>
              <p className="text-[10px] text-slate-400 mt-0.5">AI Knowledge Assistant User</p>
            </div>

            <div className="space-y-2.5 text-xs text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Application Name:</span>
                <span className="font-semibold text-slate-200">RAGForge</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Joined Date:</span>
                <span className="font-semibold text-slate-200 font-mono">July 2026</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Conversations:</span>
                <span className="font-semibold text-indigo-400 font-mono font-bold">{conversations.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Total Uploaded Documents:</span>
                <span className="font-semibold text-indigo-400 font-mono font-bold">{documents.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Theme Mode:</span>
                <span className="font-semibold text-slate-200">{isDarkMode ? "Dark Mode" : "Light Mode"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Application Version:</span>
                <span className="font-semibold text-slate-200 font-mono">v1.0.0</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setProfileModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: Clear All Chats Confirmation */}
      {clearAllConfirmOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in font-sans">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl`}>
            <h3 className="text-base font-bold text-slate-100 mb-2">Clear All Chats?</h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              This will permanently remove all conversation history. Your uploaded documents will remain available.
            </p>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setClearAllConfirmOpen(false)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer ${
                  isDarkMode ? "text-slate-400" : "text-slate-600 bg-slate-100 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setClearAllConfirmOpen(false);
                  setConversations([]);
                  setActiveConversationId(null);
                  setChatMessages([]);
                  localStorage.removeItem("ragforge_conversations");
                  addToast("All conversations cleared.", "success");
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Clear All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: Logout Confirmation */}
      {logoutConfirmOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in font-sans">
          <div className={`w-full max-w-sm rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl`}>
            <h3 className="text-base font-bold text-slate-100 mb-2">Logout?</h3>
            <p className="text-xs text-slate-400 mb-6 leading-relaxed">
              This will clear your current session. Uploaded documents and database records will remain intact.
            </p>
            
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setLogoutConfirmOpen(false)}
                className={`px-4 py-2 rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer ${
                  isDarkMode ? "text-slate-400" : "text-slate-600 bg-slate-100 hover:bg-slate-200"
                }`}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  setLogoutConfirmOpen(false);
                  setActiveConversationId(null);
                  setChatMessages([]);
                  setCurrentStreamText("");
                  setCurrentCitations([]);
                  setActiveTab("chat");
                  addToast("You have been logged out.", "success");
                }}
                className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 6: About RAGForge Modal */}
      {aboutModalOpen && (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center p-6 z-50 animate-fade-in font-sans">
          <div className={`w-full max-w-md rounded-2xl p-6 ${isDarkMode ? "bg-[#0c0f18] border border-[#151c2d]" : "bg-white border border-slate-200"} shadow-xl relative`}>
            <h3 className="text-base font-bold text-slate-100 mb-2 flex items-center gap-2">
              <Sparkles className="h-4.5 w-4.5 text-indigo-400" />
              <span>About RAGForge</span>
            </h3>
            <p className="text-[10px] text-slate-400 mb-4">Enterprise AI Knowledge Assistant</p>
            
            <div className="space-y-4 text-xs text-slate-300">
              <p className="leading-relaxed">
                RAGForge is a premium document QA assistant utilizing ChromaDB semantic search and Google Gemini for real-time document information retrieval and synthesis.
              </p>

              <div className={`p-3.5 rounded-xl space-y-2 border border-white/5 ${isDarkMode ? "bg-[#05070c]" : "bg-slate-50"}`}>
                <div className="flex justify-between">
                  <span className="text-slate-400">Version:</span>
                  <span className="font-semibold text-slate-200 font-mono">v1.0.0</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Developer:</span>
                  <span className="font-semibold text-slate-200">Uma Surya Teja</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">License:</span>
                  <span className="font-semibold text-slate-200 font-mono">MIT</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-200">Built With:</div>
                <div className="flex flex-wrap gap-1.5">
                  {["React", "FastAPI", "ChromaDB", "Sentence Transformers", "Google Gemini", "Tailwind CSS"].map((tech) => (
                    <span key={tech} className="px-2 py-0.5 rounded bg-indigo-500/10 text-indigo-400 text-[10px] font-medium border border-indigo-500/15">
                      {tech}
                    </span>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <div className="font-semibold text-slate-200">Core Features:</div>
                <div className="flex flex-wrap gap-1.5">
                  {["Document Chat", "Semantic Search", "RAG Pipeline", "Multi-Document Support"].map((feat) => (
                    <span key={feat} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px] font-medium">
                      {feat}
                    </span>
                  ))}
                </div>
              </div>

              <div className="flex items-center justify-between border-t border-slate-800/40 pt-4 mt-4">
                <div className="flex gap-2">
                  <a
                    href="https://github.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded-lg text-slate-200 transition-colors"
                  >
                    GitHub
                  </a>
                  <a
                    href="https://linkedin.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded-lg text-slate-200 transition-colors"
                  >
                    LinkedIn
                  </a>
                  <a
                    href="https://google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold rounded-lg text-slate-200 transition-colors"
                  >
                    Portfolio
                  </a>
                </div>
                
                <button
                  onClick={() => setAboutModalOpen(false)}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-semibold transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast notifications handler */}
      <div className="fixed bottom-6 right-6 space-y-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-3 rounded-xl shadow-lg text-xs font-medium flex items-center gap-2.5 animate-slide-up border ${
              t.type === "error"
                ? "bg-rose-600/90 text-white border-rose-500/10 shadow-rose-600/10"
                : "bg-emerald-600/90 text-white border-emerald-500/10 shadow-emerald-600/10"
            }`}
          >
            <Check className="h-4 w-4" />
            <span>{t.message}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// Estimate PDF page count from chunk count
const estimatePages = (chunks) => {
  return Math.max(1, Math.ceil(chunks / 2.5));
};

// Custom Markdown Parsing Renderer
const renderMarkdown = (text) => {
  if (!text) return "";
  
  // Split content by code blocks first
  const parts = text.split(/(```[\s\S]*?```)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith("```")) {
      // Code Block
      const match = part.match(/```(\w*)\n([\s\S]*?)```/);
      const language = match ? match[1] : "";
      const codeContent = match ? match[2] : part.slice(3, -3);
      const highlightedCode = highlightCode(codeContent, language);
      
      return (
        <div key={index} className="relative my-3 group w-full overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2 bg-[#0c0f17] border-b border-white/5 rounded-t-xl text-[10px] font-mono text-slate-400">
            <span>{language || "code"}</span>
            <button
              onClick={() => navigator.clipboard.writeText(codeContent)}
              className="hover:text-indigo-400 transition-colors flex items-center gap-1 font-semibold cursor-pointer"
              type="button"
            >
              <Copy className="h-3 w-3" />
              <span>Copy</span>
            </button>
          </div>
          <pre className="!mt-0 !rounded-t-none !rounded-b-xl overflow-x-auto bg-[#0a0c12]">
            <code dangerouslySetInnerHTML={{ __html: highlightedCode }} />
          </pre>
        </div>
      );
    } else {
      // Inline, Paragraph, and Table formatting
      const lines = part.split("\n");
      let listItems = [];
      let tableRows = [];
      let tableHeaders = [];
      let inTable = false;
      let renderedElements = [];
      
      const flushList = (key) => {
        if (listItems.length > 0) {
          renderedElements.push(
            <ul key={`ul-${key}`} className="list-disc pl-5 my-2 space-y-1 text-slate-300 text-[14px]">
              {listItems}
            </ul>
          );
          listItems = [];
        }
      };

      const flushTable = (key) => {
        if (tableRows.length > 0 || tableHeaders.length > 0) {
          renderedElements.push(
            <div key={`table-wrapper-${key}`} className="my-4 overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-xl">
              <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-800 text-left text-[13px] leading-relaxed">
                {tableHeaders.length > 0 && (
                  <thead className="bg-[#0b0e14] dark:bg-slate-900/50 text-slate-200 font-semibold">
                    <tr>
                      {tableHeaders.map((h, i) => (
                        <th key={i} className="px-4 py-2.5 font-bold" dangerouslySetInnerHTML={{ __html: formatInline(h) }} />
                      ))}
                    </tr>
                  </thead>
                )}
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/40">
                  {tableRows.map((row, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-900/20">
                      {row.map((cell, j) => (
                        <td key={j} className="px-4 py-2.5 text-slate-300" dangerouslySetInnerHTML={{ __html: formatInline(cell) }} />
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
          tableRows = [];
          tableHeaders = [];
          inTable = false;
        }
      };

      lines.forEach((line, lineIdx) => {
        const trimmed = line.trim();
        
        if (trimmed.startsWith("|")) {
          flushList(lineIdx);
          // Split by | and filter out empty cells at the start and end
          let cells = line.split("|").map(c => c.trim());
          if (line.startsWith("|")) cells.shift();
          if (line.endsWith("|")) cells.pop();
          
          // Check if it is a separator line (like |---|---|)
          const isSeparator = cells.every(c => c === "" || /^[:-]+$/.test(c));
          
          if (isSeparator) {
            inTable = true;
            if (tableRows.length > 0) {
              tableHeaders = tableRows.pop();
            }
          } else {
            tableRows.push(cells);
            inTable = true;
          }
        }
        else {
          if (inTable) {
            flushTable(lineIdx);
          }
          
          if (trimmed.startsWith("* ") || trimmed.startsWith("- ")) {
            const content = trimmed.substring(2);
            listItems.push(<li key={`li-${lineIdx}`} dangerouslySetInnerHTML={{ __html: formatInline(content) }} />);
          } 
          else if (/^\d+\.\s/.test(trimmed)) {
            flushList(lineIdx);
            const content = trimmed.replace(/^\d+\.\s/, "");
            const num = trimmed.match(/^(\d+)\.\s/)[1];
            renderedElements.push(
              <ol key={`ol-${lineIdx}`} start={num} className="list-decimal pl-5 my-2 space-y-1 text-slate-300 text-[14px]">
                <li dangerouslySetInnerHTML={{ __html: formatInline(content) }} />
              </ol>
            );
          }
          else if (trimmed.startsWith("### ")) {
            flushList(lineIdx);
            renderedElements.push(<h4 key={lineIdx} className="text-sm font-bold text-slate-200 mt-4 mb-2 font-display" dangerouslySetInnerHTML={{ __html: formatInline(trimmed.substring(4)) }} />);
          } else if (trimmed.startsWith("## ")) {
            flushList(lineIdx);
            renderedElements.push(<h3 key={lineIdx} className="text-base font-bold text-slate-200 mt-4 mb-2 font-display" dangerouslySetInnerHTML={{ __html: formatInline(trimmed.substring(3)) }} />);
          } else if (trimmed.startsWith("# ")) {
            flushList(lineIdx);
            renderedElements.push(<h2 key={lineIdx} className="text-lg font-bold text-slate-200 mt-4 mb-2 font-display" dangerouslySetInnerHTML={{ __html: formatInline(trimmed.substring(2)) }} />);
          }
          else if (trimmed === "") {
            flushList(lineIdx);
            renderedElements.push(<div key={lineIdx} className="h-2" />);
          }
          else {
            flushList(lineIdx);
            renderedElements.push(
              <p key={lineIdx} className="text-slate-300 text-[14px] leading-relaxed my-1.5" dangerouslySetInnerHTML={{ __html: formatInline(line) }} />
            );
          }
        }
      });
      
      flushList(lines.length);
      flushTable(lines.length);
      return <React.Fragment key={index}>{renderedElements}</React.Fragment>;
    }
  });
};

// Custom message renderer to display error states gracefully
const renderMessageContent = (text) => {
  if (!text) return "";
  if (
    text.includes("AI service is temporarily unavailable") || 
    text.includes("limit has been reached") || 
    text.includes("quota has been reached") ||
    text.includes("ResourceExhausted")
  ) {
    return (
      <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-200 space-y-2 text-xs w-full max-w-md">
        <div className="flex items-center gap-2 font-bold text-amber-400">
          <span>⚠ AI service is temporarily unavailable.</span>
        </div>
        <div>
          <span className="font-semibold block text-slate-400">Reason</span>
          <p className="mt-0.5">The configured Gemini API key has reached its usage limit.</p>
        </div>
        <div className="pt-1">
          <span className="font-semibold block text-slate-400">Options</span>
          <ul className="list-disc pl-4 mt-1 space-y-0.5">
            <li>Try again later.</li>
            <li>Configure another Gemini API key.</li>
          </ul>
        </div>
      </div>
    );
  }
  return renderMarkdown(text);
};

// Dynamic suggested questions matching
const getFollowUpQuestions = (lastMsg) => {
  if (!lastMsg) return [];
  const text = lastMsg.text.toLowerCase();
  if (text.includes("method") || text.includes("how")) {
    return [
      "What are the specific results of this method?",
      "Are there references or pages mentioned?",
      "What are the main drawbacks discussed?"
    ];
  }
  if (text.includes("summar") || text.includes("overview")) {
    return [
      "What key metrics or statistics are included?",
      "Identify the primary challenges discussed.",
      "List the recommended action items."
    ];
  }
  return [
    "Can you provide a summary of the main points?",
    "Which specific document references support this?",
    "Are there alternative perspectives listed?"
  ];
};

export default App;