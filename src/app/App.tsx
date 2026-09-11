import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Settings,
  User,
  LogOut,
  Loader2,
  PanelLeft,
  MessageSquare,
  Trash2,
  ExternalLink,
} from "lucide-react";
import logo from "../imports/image.png";
import { LandingPage } from "./components/LandingPage";
import { PathfinderChat } from "./components/PathfinderChat";
import { supabaseConfigError } from "@/lib/supabaseClient";
import {
  useAuth,
  getDisplayName,
  getDisplayEmail,
  getInitials,
} from "@/lib/AuthProvider";
import {
  listConversations,
  getConversationMessages,
  deleteConversation,
  formatConversationDate,
  type ConversationSummary,
  type ChatMessage,
} from "@/lib/conversations";

const coaches = [
  {
    name: "Job Search Coach",
    description: "Build a focused target list",
    initials: "JS",
    href: "https://chatgpt.com/g/g-6994a70db24c8191a903c64842cf85df-archer-job-search-target-list",
    color: "bg-[#eee9fb] text-[#6f4fb5]",
  },
  {
    name: "Networking Coach",
    description: "Build meaningful relationships",
    initials: "NC",
    href: "https://chatgpt.com/g/g-691d0b3e51208191a91890adf323089f-archer-networking-coach",
    color: "bg-[#e8f4f2] text-[#438f83]",
  },
  {
    name: "Resume Coach",
    description: "Align your credentials",
    initials: "RC",
    href: "https://chatgpt.com/g/g-688a2d3690788191a2b3a32bd6449032-archer-resume-coach",
    color: "bg-[#f9ece8] text-[#c86d5e]",
  },
  {
    name: "Interview Coach",
    description: "Master the interview",
    initials: "IC",
    href: "https://chatgpt.com/g/g-68c4389c741c81919b4a0f3dacf0b555-archer-interview-coach",
    color: "bg-[#f5f0e3] text-[#b48b3d]",
  },
] as const;

export default function App() {
  const isPreview =
    import.meta.env.DEV &&
    new URLSearchParams(window.location.search).get("preview") === "true";

  if (supabaseConfigError && !isPreview) {
    return (
      <div className="min-h-screen w-screen flex items-center justify-center bg-white px-6 text-center">
        <div>
          <h1 className="text-xl font-semibold text-[#173C7A]">
            Franklin is not configured
          </h1>
          <p className="mt-2 text-gray-600">
            This app is temporarily unavailable. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  return <ConfiguredApp />;
}

function ConfiguredApp() {
  const { session, user, isGuest, isPreview, loading, signOut } = useAuth();
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);

  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [conversationsLoading, setConversationsLoading] = useState(false);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [loadedMessages, setLoadedMessages] = useState<ChatMessage[] | null>(null);
  const [resetSignal, setResetSignal] = useState(0);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);

  const refreshConversations = useCallback(async () => {
    setConversationsLoading(true);
    try {
      const list = await listConversations();
      setConversations(list);
    } catch {
      /* sidebar list failure is non-fatal */
    } finally {
      setConversationsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (session) {
      refreshConversations();
    } else {
      setConversations([]);
      setActiveConversationId(null);
      setLoadedMessages(null);
    }
  }, [session, refreshConversations]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-white">
        <Loader2 size={32} className="animate-spin text-[#306FB8]" />
      </div>
    );
  }

  if (!session && !isPreview) {
    return <LandingPage />;
  }

  const displayName = getDisplayName(user, isGuest);
  const displayEmail = getDisplayEmail(user, isGuest);
  const initials = getInitials(user, isGuest);

  const handleSignOut = async () => {
    setIsProfileMenuOpen(false);
    await signOut();
  };

  const handleNewChat = () => {
    setActiveConversationId(null);
    setLoadedMessages(null);
    setResetSignal((n) => n + 1);
  };

  const handleSelectConversation = async (id: string) => {
    setActiveConversationId(id);
    setLoadedMessages(null);
    try {
      const messages = await getConversationMessages(id);
      setLoadedMessages(messages);
    } catch {
      setLoadedMessages([]);
    }
  };

  const handleDeleteConversation = async (id: string) => {
    setConfirmingDeleteId(null);
    try {
      await deleteConversation(id);
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setLoadedMessages(null);
        setResetSignal((n) => n + 1);
      }
      await refreshConversations();
    } catch {
      /* delete failure is non-fatal */
    }
  };

  return (
    <div
      className="min-h-screen bg-white relative overflow-hidden font-sans"
      style={{
        backgroundImage:
          "radial-gradient(circle, rgba(23, 60, 122, 0.056) 1px, transparent 2px)",
        backgroundSize: "36px 36px",
      }}
    >
      <motion.button
        initial={false}
        onClick={() => setIsSidebarOpen(!isSidebarOpen)}
        className="fixed top-6 left-6 text-[#173C7A] hover:opacity-70 z-[60]"
        animate={{ x: isSidebarOpen ? "12rem" : "0rem" }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <PanelLeft size={24} />
      </motion.button>

      <AnimatePresence initial={false}>
        {isSidebarOpen && (
          <motion.div
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.2, ease: "easeOut" }}
            className="fixed top-0 left-0 h-full w-64 bg-white shadow-2xl border-r border-[#173C7A]/10 z-50 flex flex-col"
          >
            <div className="h-[64px] flex items-center pl-5 pr-14 border-b border-[#173C7A]/10">
              <img
                src={logo}
                alt="Franklin"
                className="h-7 cursor-pointer hover:opacity-80 transition-opacity"
                onClick={handleNewChat}
              />
            </div>

            <div className="px-3 pt-1">
              <button
                onClick={handleNewChat}
                className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-all bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                <MessageSquare size={16} />
                New Chat
              </button>
            </div>

            <div className="mx-3 h-px bg-[#173C7A]/10 my-1.5" />

            <div className="px-3 pt-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-2 mb-1.5">
                Coaches
              </p>
              <nav aria-label="Career coaches" className="space-y-0.5">
                {coaches.map((coach) => (
                  <a
                    key={coach.name}
                    href={coach.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group flex items-center gap-2.5 px-2 py-2 rounded-lg text-[#173C7A] hover:bg-[#173C7A]/5 transition-colors"
                  >
                    <span
                      className={`w-7 h-7 shrink-0 rounded-md flex items-center justify-center text-[10px] font-bold ${coach.color}`}
                    >
                      {coach.initials}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[12px] font-semibold truncate leading-tight">
                        {coach.name}
                      </span>
                      <span className="block text-[10px] text-gray-400 truncate mt-0.5">
                        {coach.description}
                      </span>
                    </span>
                    <ExternalLink
                      size={13}
                      aria-hidden="true"
                      className="shrink-0 text-gray-300 group-hover:text-[#306FB8] transition-colors"
                    />
                  </a>
                ))}
              </nav>
            </div>

            <div className="mx-3 h-px bg-[#173C7A]/10 my-1.5" />

            <div className="flex-1 min-h-0 flex flex-col px-3 pt-3 pb-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400 px-2 mb-2">
                Recent
              </p>
              <div className="flex-1 overflow-y-auto archer-scroll space-y-0.5">
                {conversationsLoading && conversations.length === 0 && (
                  <div className="flex justify-center py-4">
                    <Loader2 size={16} className="animate-spin text-gray-400" />
                  </div>
                )}
                {!conversationsLoading && conversations.length === 0 && (
                  <p className="text-[12px] text-gray-400 px-2 py-2">No chats yet</p>
                )}
                {conversations.map((conv) => (
                  <div
                    key={conv.id}
                    className={`group flex items-center gap-0.5 rounded-lg ${
                      activeConversationId === conv.id ? "bg-[#306FB8]/10" : "hover:bg-gray-50"
                    }`}
                  >
                    {confirmingDeleteId === conv.id ? (
                      <div className="flex-1 flex items-center justify-between gap-2 px-2 py-1.5">
                        <span className="text-[12px] font-medium text-gray-700">Delete chat?</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => handleDeleteConversation(conv.id)}
                            className="px-2 py-1 rounded-md text-[11px] font-medium text-red-600 hover:bg-red-50 transition-colors"
                          >
                            Delete?
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingDeleteId(null)}
                            className="px-2 py-1 rounded-md text-[11px] font-medium text-gray-600 hover:bg-gray-100 transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => handleSelectConversation(conv.id)}
                          className={`flex-1 min-w-0 text-left px-2.5 py-2 rounded-lg transition-colors ${
                            activeConversationId === conv.id ? "text-[#173C7A]" : "text-gray-700"
                          }`}
                        >
                          <p className="text-[13px] font-medium truncate leading-tight">{conv.title}</p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {formatConversationDate(conv.updated_at)}
                          </p>
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingDeleteId(conv.id)}
                          aria-label={`Delete chat: ${conv.title}`}
                          className={`shrink-0 p-2 mr-0.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50 transition-all ${
                            activeConversationId === conv.id
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="p-3 border-t border-[#173C7A]/10 relative">
              <button
                onClick={() => setIsProfileMenuOpen(!isProfileMenuOpen)}
                className="w-full flex items-center gap-2.5 p-1.5 hover:bg-gray-50 rounded-lg transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-[#173C7A]/10 flex items-center justify-center text-[#173C7A] text-sm font-bold">
                  {initials}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-[#173C7A] truncate leading-tight">
                    {displayName}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate leading-tight">{displayEmail}</p>
                </div>
              </button>

              <AnimatePresence>
                {isProfileMenuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-[60]"
                      onClick={() => setIsProfileMenuOpen(false)}
                    />
                    <motion.div
                      initial={{ opacity: 0, y: 10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute bottom-full left-3 right-3 mb-2 bg-white rounded-lg shadow-xl border border-[#173C7A]/10 overflow-hidden z-[70]"
                    >
                      <div className="px-3 py-2 border-b border-[#173C7A]/10 bg-gray-50/50">
                        <p className="text-[13px] font-medium text-[#173C7A] leading-tight">
                          {displayName}
                        </p>
                        <p className="text-[11px] text-gray-500 leading-tight">{displayEmail}</p>
                      </div>
                      <div className="py-1.5">
                        <button className="w-full px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-[#306FB8] flex items-center gap-2.5 transition-colors text-left">
                          <User size={14} />
                          Your Profile
                        </button>
                        <button className="w-full px-3 py-1.5 text-[13px] text-gray-700 hover:bg-gray-50 hover:text-[#306FB8] flex items-center gap-2.5 transition-colors text-left">
                          <Settings size={14} />
                          Account Settings
                        </button>
                      </div>
                      <div className="border-t border-[#173C7A]/10 py-1.5">
                        <button
                          onClick={handleSignOut}
                          className="w-full px-3 py-1.5 text-[13px] text-red-600 hover:bg-red-50 flex items-center gap-2.5 transition-colors"
                        >
                          <LogOut size={14} />
                          Sign Out
                        </button>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="absolute inset-y-0 right-0 flex flex-col items-center"
        initial={false}
        animate={{ left: isSidebarOpen ? "16rem" : "0rem" }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <PathfinderChat
          key={`pathfinder-${resetSignal}`}
          activeConversationId={activeConversationId}
          onActiveConversationChange={setActiveConversationId}
          onConversationsChange={refreshConversations}
          loadedMessages={loadedMessages}
          resetSignal={resetSignal}
        />
      </motion.div>
    </div>
  );
}
