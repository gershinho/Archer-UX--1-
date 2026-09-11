import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Loader2 } from "lucide-react";
import logo from "../../imports/image.png";
import { ask, AskError } from "@/lib/ask";
import {
  saveExchange,
  type ChatMessage,
} from "@/lib/conversations";
import { FormattedAnswer } from "./FormattedAnswer";

const MAX_COMPOSER_HEIGHT = 200;

function sliceWithCompleteUrls(text: string, endIndex: number): string {
  const slice = text.slice(0, endIndex);
  const urlPattern = /https?:\/\/[^\s)>\]"']+/g;
  let match: RegExpExecArray | null;
  while ((match = urlPattern.exec(text)) !== null) {
    const urlStart = match.index;
    const urlEnd = urlStart + match[0].length;
    if (endIndex > urlStart && endIndex < urlEnd) {
      return text.slice(0, urlEnd);
    }
  }
  return slice;
}

type PathfinderChatProps = {
  activeConversationId: string | null;
  onActiveConversationChange: (id: string) => void;
  onConversationsChange: () => void;
  loadedMessages: ChatMessage[] | null;
  resetSignal: number;
};

export function PathfinderChat({
  activeConversationId,
  onActiveConversationChange,
  onConversationsChange,
  loadedMessages,
  resetSignal,
}: PathfinderChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [typedText, setTypedText] = useState("");
  const [animatingMessageId, setAnimatingMessageId] = useState<string | null>(null);
  const [composerHeight, setComposerHeight] = useState(56);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const conversationIdRef = useRef<string | null>(activeConversationId);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

  const hasMessages = messages.length > 0;
  const showChatPanel = hasMessages || isAsking || activeConversationId !== null;
  const isSearching = showChatPanel;
  const isComposerExpanded = isSearching || composerHeight > 56;

  useEffect(() => {
    conversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    const nextHeight = Math.min(textarea.scrollHeight, MAX_COMPOSER_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY =
      textarea.scrollHeight > MAX_COMPOSER_HEIGHT ? "auto" : "hidden";
    setComposerHeight(nextHeight);
  }, [searchQuery]);

  useEffect(() => {
    setMessages([]);
    setSearchQuery("");
    setTypedText("");
    setAnimatingMessageId(null);
    setIsAsking(false);
    shouldAutoScrollRef.current = true;
  }, [resetSignal]);

  useEffect(() => {
    if (loadedMessages !== null) {
      setMessages(loadedMessages);
      setSearchQuery("");
      setTypedText("");
      setAnimatingMessageId(null);
      setIsAsking(false);
      shouldAutoScrollRef.current = true;
    }
  }, [loadedMessages]);

  const latestAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const fullText = latestAssistant?.content ?? "";

  useEffect(() => {
    if (!animatingMessageId || !fullText) {
      setTypedText("");
      return;
    }

    let i = 0;
    setTypedText("");
    const interval = setInterval(() => {
      setTypedText(sliceWithCompleteUrls(fullText, i));
      i++;
      if (i > fullText.length) {
        clearInterval(interval);
        setAnimatingMessageId(null);
      }
    }, 15);

    return () => clearInterval(interval);
  }, [animatingMessageId, fullText]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (container && shouldAutoScrollRef.current) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages.length, typedText]);

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;

    shouldAutoScrollRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <= 80;
  };

  const handleSearch = async () => {
    const queryToAsk = searchQuery.trim();
    if (!queryToAsk || isAsking) return;

    const userMsg: ChatMessage = {
      id: `temp-user-${Date.now()}`,
      role: "user",
      content: queryToAsk,
      metadata: null,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    setSearchQuery("");
    setComposerHeight(56);
    setIsAsking(true);

    let conversationId = conversationIdRef.current;

    try {
      const res = await ask(queryToAsk);

      const assistantMsg: ChatMessage = {
        id: `temp-assistant-${Date.now()}`,
        role: "assistant",
        content: res.answer,
        metadata: {
          sources: res.sources,
          classified: res.classified,
          framework_refs_used: res.framework_refs_used,
          was_filtered: res.was_filtered,
        },
        created_at: new Date().toISOString(),
      };

      setMessages((prev) => [...prev, assistantMsg]);
      setAnimatingMessageId(assistantMsg.id);

      conversationId = await saveExchange(queryToAsk, res.answer, {
        sources: res.sources,
        classified: res.classified,
        framework_refs_used: res.framework_refs_used,
        was_filtered: res.was_filtered,
      }, conversationId);

      conversationIdRef.current = conversationId;
      onActiveConversationChange(conversationId);
      onConversationsChange();
    } catch (e) {
      if (e instanceof AskError) {
        console.error("Ask request failed:", e.detail);
      } else {
        console.error("Ask request failed:", e);
      }
      const errorMsg: ChatMessage = {
        id: `temp-error-${Date.now()}`,
        role: "assistant",
        content: e instanceof AskError ? e.message : "Sorry — something went wrong. Please try again.",
        metadata: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsAsking(false);
    }
  };

  const renderAssistantContent = (msg: ChatMessage) => {
    const isLatest = msg.id === latestAssistant?.id;
    const isAnimating = isLatest && animatingMessageId === msg.id;

    if (isAnimating) {
      if (typedText) {
        return (
          <FormattedAnswer
            text={typedText}
            isTyping={isAsking || typedText.length < fullText.length}
          />
        );
      }
      return (
        <div className="flex items-center gap-2 text-gray-500 text-[15px]">
          <Loader2 className="animate-spin" size={16} />
          <span>Thinking…</span>
        </div>
      );
    }

    return <FormattedAnswer text={msg.content} isTyping={false} />;
  };

  return (
    <>
      <motion.div
        className="absolute z-50 flex items-center gap-4"
        initial={false}
        animate={{
          left: "50%",
          top: "50%",
          x: "-50%",
          y: "-120px",
          opacity: isSearching ? 0 : 1,
        }}
        transition={{ duration: 0.5, ease: "easeInOut" }}
        style={{
          pointerEvents: isSearching ? "none" : "auto",
          transformOrigin: "center",
        }}
      >
        <img
          src={logo}
          alt="Franklin"
          className="h-16 opacity-90 cursor-pointer transition-opacity hover:opacity-100"
          onClick={() => {
            /* logo click kept for visual consistency */
          }}
        />
      </motion.div>

      <AnimatePresence>
        {isSearching && (
          <motion.div
            layout
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10, transition: { duration: 0.2, ease: "easeIn" } }}
            transition={{ duration: 0.4, ease: "easeInOut" }}
            className="absolute top-[72px] w-full max-w-6xl px-6 flex"
            style={{ gap: "0rem", bottom: "130px" }}
          >
            <motion.div
              layout
              className="flex flex-col w-full min-h-0"
              transition={{ duration: 0.4, ease: "easeInOut" }}
            >
              <div className="bg-gradient-to-br from-white to-[#306FB8]/[0.03] rounded-2xl border border-[#173C7A]/10 flex-1 min-h-0 shadow-sm relative overflow-hidden flex flex-col">
                <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-[#306FB8] to-[#173C7A] opacity-80" />
                <div className="flex items-center justify-between px-8 pt-7 pb-4 border-b border-[#173C7A]/5">
                  <h3 className="text-lg font-semibold text-[#173C7A] flex items-center gap-3">
                    <span className="relative flex h-3 w-3">
                      {(isAsking || animatingMessageId) && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#306FB8] opacity-75" />
                      )}
                      <span className="relative inline-flex rounded-full h-3 w-3 bg-[#306FB8]" />
                    </span>
                    Franklin Response
                  </h3>
                </div>
                <div
                  ref={scrollContainerRef}
                  onScroll={handleScroll}
                  className="flex-1 overflow-y-auto px-8 py-6 archer-scroll space-y-6"
                >
                  {!hasMessages && !isAsking && activeConversationId && (
                    <p className="text-sm text-gray-500 text-center py-4">
                      No messages in this chat yet. Ask a question below to continue.
                    </p>
                  )}
                  {messages.map((msg) =>
                    msg.role === "user" ? (
                      <div key={msg.id} className="flex justify-end">
                        <div className="max-w-[85%] bg-[#173C7A] text-white text-[15px] leading-relaxed px-4 py-3 rounded-2xl rounded-br-md">
                          {msg.content}
                        </div>
                      </div>
                    ) : (
                      <div key={msg.id} className="min-w-0">
                        {renderAssistantContent(msg)}
                      </div>
                    )
                  )}
                  {isAsking && messages[messages.length - 1]?.role === "user" && (
                    <div className="flex items-center gap-2 text-gray-500 text-[15px]">
                      <Loader2 className="animate-spin" size={16} />
                      <span>Thinking…</span>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <motion.div
        className="absolute z-40 px-6 w-full"
        initial={false}
        animate={{
          left: "50%",
          top: isSearching ? "calc(100% - 80px)" : "50%",
          x: "-50%",
          y: "-50%",
          maxWidth: isSearching ? "72rem" : "42rem",
        }}
        transition={{ duration: 0.7, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <div
          className={`relative w-full transition-transform duration-300 ${!isSearching && "hover:scale-[1.02]"}`}
        >
          <textarea
            ref={textareaRef}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.metaKey) {
                e.preventDefault();
                handleSearch();
              } else if (e.key === "Enter" && e.metaKey) {
                e.preventDefault();
                const target = e.target as HTMLTextAreaElement;
                const start = target.selectionStart;
                const end = target.selectionEnd;
                const newValue =
                  searchQuery.substring(0, start) + "\n" + searchQuery.substring(end);
                setSearchQuery(newValue);
                requestAnimationFrame(() => {
                  target.setSelectionRange(start + 1, start + 1);
                });
              }
            }}
            placeholder={isSearching ? "Ask a new question..." : "Search for career advice..."}
            className={`block w-full px-6 pr-16 border-2 border-[#173C7A] focus:outline-none bg-white shadow-md text-gray-800 resize-none overflow-x-hidden leading-[24px] ${
              isComposerExpanded ? "py-[13px] rounded-3xl" : "py-[14px] rounded-full"
            }`}
            style={{ height: `${composerHeight}px` }}
          />
          <button
            onClick={handleSearch}
            disabled={isAsking}
            className={`absolute right-2 flex items-center justify-center w-[44px] h-[44px] bg-[#306FB8] hover:bg-[#173C7A] disabled:opacity-60 text-white rounded-full transition-transform hover:scale-110 active:scale-95 ${
              isComposerExpanded
                ? "top-1/2 -translate-y-1/2 bg-[#173C7A]"
                : "top-1/2 -translate-y-1/2"
            }`}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
          </button>
        </div>
      </motion.div>
    </>
  );
}
