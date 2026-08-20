import { useState, useRef, useEffect, useMemo } from 'react';
import Groq from 'groq-sdk';
import { Send, User, Lightbulb, FileText, CheckSquare, Sparkles, MessageSquare, BrainCircuit, ArrowRight, CheckCircle2, GraduationCap, ChevronRight, BookOpen, Clock, Activity, Target } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import mermaid from 'mermaid';
import 'katex/dist/katex.min.css';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { auth, db, loginWithGoogle, logout } from './lib/firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, setDoc, getDoc } from 'firebase/firestore';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// SETUP GENAI
let aiClient: Groq | null = null;
function getAI() {
  if (!aiClient) {
    // Only use import.meta.env for Vite! The string fallback is provided.
    const groqKey = import.meta.env.VITE_GROQ_API_KEY;
    if (!groqKey) {
      throw new Error("GROQ API key is missing. Please set VITE_GROQ_API_KEY.");
    }
    aiClient = new Groq({ apiKey: groqKey, dangerouslyAllowBrowser: true });
  }
  return aiClient;
}

// TYPES
type Mode = 'explain' | 'summary' | 'quiz';

// SETUP MERMAID
mermaid.initialize({ startOnLoad: false, theme: 'dark', suppressErrorRendering: true });

const MermaidChart = ({ code }: { code: string }) => {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (chartRef.current) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`;
      // Sanitize common LLM mermaid syntax mistakes
      let sanitizedCode = code.replace(/-->\|([^|]+)\|>?/g, '-- $1 -->');
      // Sometimes it outputs -- text -- >
      sanitizedCode = sanitizedCode.replace(/--([^-]+)--\s*>/g, '-- $1 -->');
      // Fix spaced arrows
      sanitizedCode = sanitizedCode.replace(/--\s+>/g, '-->');
      
      mermaid.render(id, sanitizedCode).then(({ svg }) => {
        if (chartRef.current) {
           chartRef.current.innerHTML = svg;
        }
      }).catch(e => {
        if (chartRef.current) {
           chartRef.current.innerHTML = `<pre class="text-red-400 text-sm overflow-auto max-w-full">Mermaid Syntax Error: ${e.message || 'Invalid syntax'}</pre>`;
        }
      });
    }
  }, [code]);

  return <div ref={chartRef} className="mermaid-chart flex justify-center my-4 overflow-x-auto w-full" />;
};

type Message = {
  id: string;
  role: 'user' | 'model';
  text: string;
  isError?: boolean;
};

const MODE_CONFIG = {
  explain: {
    id: 'explain',
    name: 'Explain',
    icon: Lightbulb,
    description: 'Break down complex topics step-by-step.',
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    activeBg: 'bg-blue-600',
    instruction: `You are Cortexium, an AI Study Assistant in "Explain Mode". Your goal is to help the user deeply understand complex topics from first principles.
Guidelines:
1. Use the Feynman Technique: Explain concepts as if the user is a beginner.
2. Use relatable, real-world analogies to make abstract concepts concrete.
3. Break the topic down into logical, bite-sized steps. Do not overwhelm with huge walls of text.
4. Define any technical jargon or complex terms immediately when used.
5. Use markdown formatting (bolding, bullet points, headers) to make the text scannable and easy to read.
6. End by asking a quick, simple thought-provoking question to check their understanding.`,
  },
  summary: {
    id: 'summary',
    name: 'Summary',
    icon: FileText,
    description: 'Convert topics into short, effective notes.',
    color: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    activeBg: 'bg-emerald-600',
    instruction: `You are Cortexium, an AI Study Assistant in "Summary Mode". Your goal is to extract the absolute core essence of a topic or text for rapid revision.
Guidelines:
1. Be extremely concise. Cut out all fluff, filler, and unnecessary examples.
2. Structure the output as "Flashcard Notes" or "Cheat Sheet" format.
3. Always include a "TL;DR" (1-2 sentences) at the very top.
4. Use bullet points heavily. 
5. Bold the most critical keywords, dates, formulas, or names.
6. Do NOT write paragraphs. If it can't be bulleted, it's too long.
7. Focus ONLY on what is strictly necessary to pass an exam or understand the core gist.`,
  },
  quiz: {
    id: 'quiz',
    name: 'Quiz',
    icon: CheckSquare,
    description: 'Generate questions to test understanding.',
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10',
    activeBg: 'bg-purple-600',
    instruction: `You are Cortexium, an AI Study Assistant in "Quiz Mode". Your goal is to actively test the user's knowledge through an interactive quiz session.
Guidelines:
1. When the user provides a topic, ask exactly ONE question to start. Do NOT ask multiple questions at once.
2. Wait for the user to answer.
3. Once they answer, evaluate it:
   - If correct: Praise them briefly, explain *why* it's correct (reinforcement), then ask the NEXT question.
   - If incorrect: Gently correct them, explain the right answer clearly, then ask the NEXT question.
4. Keep questions focused on core concepts. Mix up question types (Multiple Choice, True/False, Short Answer).
5. Act like an encouraging tutor. Keep the tone engaging and interactive.`,
  }
} as const;

// ---- ASSETS / BRANDING ----
function CortexiumLogo({ className = "w-6 h-6", glow = true }: { className?: string, glow?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="logo-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#60A5FA" />
          <stop offset="100%" stopColor="#A78BFA" />
        </linearGradient>
        {glow && (
          <filter id="logo-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="8" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        )}
      </defs>
      
      {/* Center Core Glow */}
      {glow && <circle cx="50" cy="50" r="16" fill="#60A5FA" filter="url(#logo-glow)" opacity="0.5" />}
      
      {/* Orbits / Rings */}
      <ellipse cx="50" cy="50" rx="38" ry="14" transform="rotate(30 50 50)" stroke="url(#logo-gradient)" strokeWidth="4" fill="none" opacity="0.9" />
      <ellipse cx="50" cy="50" rx="38" ry="14" transform="rotate(150 50 50)" stroke="url(#logo-gradient)" strokeWidth="4" fill="none" opacity="0.9" />
      <ellipse cx="50" cy="50" rx="38" ry="14" transform="rotate(90 50 50)" stroke="url(#logo-gradient)" strokeWidth="3" fill="none" opacity="0.4" />
      
      {/* Center Intelligence / Star shape */}
      <path d="M 50 28 Q 56 45 72 50 Q 56 55 50 72 Q 44 55 28 50 Q 44 45 50 28 Z" fill="#FFFFFF" filter={glow ? "url(#logo-glow)" : undefined} />
    </svg>
  );
}

// ---- CHAT APP COMPONENT ----
function CortexiumApp({ onExit, initialPrompt, initialMode, user }: { onExit: () => void, initialPrompt?: string, initialMode?: Mode, user: FirebaseUser | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [mode, setMode] = useState<Mode>(initialMode || 'explain');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  
  const hasInitialized = useRef(false);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  useEffect(() => {
    if (initialPrompt && !hasInitialized.current) {
      hasInitialized.current = true;
      handleSendMessage(initialPrompt);
    }
  }, [initialPrompt]);

  // Load chat history if logged in
  useEffect(() => {
    if (user && !hasInitialized.current) {
      getDoc(doc(db, 'users', user.uid, 'chats', 'current')).then((snap) => {
        if (snap.exists()) {
          const data = snap.data();
          if (data.messages && data.messages.length > 0) {
            setMessages(data.messages);
          }
        }
      }).catch(err => console.error("Error loading chat history:", err));
    }
  }, [user]);

  // Save chat history
  useEffect(() => {
    if (user && messages.length > 0 && !isTyping) {
      setDoc(doc(db, 'users', user.uid, 'chats', 'current'), {
        messages: messages
      }, { merge: true }).catch(err => console.error("Error saving chat history:", err));
    }
  }, [messages, user, isTyping]);

  const handleSendMessage = async (text: string) => {
    if (!text.trim() || isTyping) return;
    
    setInput('');
    const userMessage: Message = { id: crypto.randomUUID(), role: 'user', text: text.trim() };
    setMessages((prev) => [...prev, userMessage]);
    setIsTyping(true);

    try {
      const groqMessages: any[] = [
        { role: 'system', content: MODE_CONFIG[mode].instruction },
        ...messages
          .filter(msg => !msg.isError)
          .map(msg => ({
            role: msg.role === 'model' ? 'assistant' : 'user',
            content: msg.text
          })),
        { role: 'user', content: text.trim() }
      ];

      const ai = getAI();
      const stream = await ai.chat.completions.create({
        model: "openai/gpt-oss-20b",
        messages: groqMessages,
        stream: true,
      });

      const startId = crypto.randomUUID();
      let fullText = '';
      
      setMessages((prev) => [...prev, { id: startId, role: 'model', text: '' }]);

      for await (const chunk of stream) {
        if (chunk.choices[0]?.delta?.content) {
          fullText += chunk.choices[0].delta.content;
          setMessages((prev) => 
            prev.map(msg => 
              msg.id === startId ? { ...msg, text: fullText } : msg
            )
          );
        }
      }
    } catch (error) {
      console.error("Failed to generate response:", error);
      const errorMessage = error instanceof Error ? error.message : String(error);
      setMessages((prev) => [
        ...prev, 
        { 
          id: crypto.randomUUID(), 
          role: 'model', 
          text: `I encountered an error processing that: ${errorMessage}. Please check if the API key is correctly configured.`,
          isError: true
        }
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    handleSendMessage(input);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="flex flex-col h-screen bg-[#0A0A0B] text-zinc-100 font-sans selection:bg-blue-500/30 selection:text-blue-100">
      <header className="flex items-center justify-between px-6 py-4 bg-[#0F0F11] border-b border-white/5 shadow-sm z-10 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onExit}
            className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400 hover:text-zinc-100 transition-colors"
            title="Back to website"
          >
            <ArrowRight className="w-5 h-5 rotate-180" />
          </button>
          <div className="flex items-center gap-2 text-white">
            <CortexiumLogo className="w-8 h-8" />
            <h1 className="text-xl font-bold tracking-tight">Cortexium</h1>
          </div>
        </div>
        
        {/* Desktop Mode Selector */}
        <div className="hidden md:flex items-center p-1 bg-white/5 rounded-full border border-white/10 shadow-inner">
          {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([key, config]) => {
            const isActive = mode === key;
            const Icon = config.icon;
            return (
              <button
                key={key}
                onClick={() => setMode(key)}
                className={cn(
                  "flex items-center gap-2 px-4 py-1.5 rounded-full text-sm font-medium transition-all duration-200",
                  isActive 
                    ? "bg-[#18181b] text-white shadow-sm ring-1 ring-white/10" 
                    : "text-zinc-400 hover:text-zinc-200 hover:bg-white/5"
                )}
              >
                <Icon className={cn("w-4 h-4", isActive ? config.color : "opacity-70")} />
                {config.name}
              </button>
            );
          })}
        </div>
        
        <div className="md:hidden flex items-center">
          <span className="text-xs font-medium text-zinc-400 px-3 py-1 bg-white/5 rounded-full border border-white/5">
            {MODE_CONFIG[mode].name}
          </span>
        </div>
      </header>

      {/* Mobile Mode Selector */}
      <div className="md:hidden flex overflow-x-auto gap-2 p-4 bg-[#0F0F11] border-b border-white/5 shrink-0 scrollbar-hide">
        {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([key, config]) => {
          const isActive = mode === key;
          const Icon = config.icon;
          return (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all whitespace-nowrap border",
                isActive 
                  ? cn("border-transparent text-white", config.activeBg) 
                  : "border-white/10 bg-white/5 text-zinc-400 hover:bg-white/10"
              )}
            >
              <Icon className="w-4 h-4" />
              {config.name}
            </button>
          );
        })}
      </div>

      <main className="flex-1 overflow-y-auto w-full scrollbar-thin scrollbar-thumb-white/10">
        <div className="max-w-4xl mx-auto w-full px-4 py-8 flex flex-col min-h-full">
          {messages.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center max-w-xl mx-auto my-auto space-y-6">
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
                className="w-20 h-20 bg-gradient-to-br from-blue-500/10 to-purple-500/10 rounded-2xl shadow-sm border border-white/10 flex items-center justify-center mb-4"
              >
                <CortexiumLogo className="w-14 h-14" />
              </motion.div>
              <h2 className="text-3xl font-bold tracking-tight text-white drop-shadow-sm">What do you want to learn today?</h2>
              <p className="text-lg text-zinc-400 leading-relaxed">
                Cortexium is your personal AI tutor. Choose a mode below to get detailed explanations, quick summaries, or test your knowledge.
              </p>
              
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full mt-8">
                {(Object.entries(MODE_CONFIG) as [Mode, typeof MODE_CONFIG[Mode]][]).map(([key, config]) => {
                  const Icon = config.icon;
                  return (
                    <button
                      key={key}
                      onClick={() => setMode(key)}
                      className={cn(
                        "flex flex-col items-center p-4 rounded-xl text-center border transition-all",
                        mode === key 
                          ? cn("border-white/20 shadow-lg bg-white/5", config.color)
                          : "border-white/5 bg-[#0F0F11] hover:border-white/10 hover:bg-white/5 shadow-sm text-zinc-300"
                      )}
                    >
                      <div className={cn("p-2 rounded-full mb-3", config.bgColor, mode === key ? config.color : "text-zinc-400")}>
                        <Icon className="w-6 h-6" />
                      </div>
                      <span className="font-semibold text-white mb-1">{config.name}</span>
                      <span className="text-xs text-zinc-500 leading-snug">{config.description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : (
            <div className="space-y-6 pb-20">
              <AnimatePresence initial={false}>
                {messages.map((msg) => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={cn("flex w-full gap-4 sm:gap-6", msg.role === 'user' ? "flex-row-reverse" : "flex-row")}
                  >
                    <div className={cn(
                      "shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mt-1 shadow-sm border",
                      msg.role === 'user' 
                        ? "bg-white/10 border-white/20" 
                        : "bg-[#18181B] border-blue-500/30"
                    )}>
                      {msg.role === 'user' 
                        ? <User className="w-5 h-5 text-zinc-300" /> 
                        : <CortexiumLogo className="w-6 h-6" glow={false} />
                      }
                    </div>

                    <div className={cn(
                      "flex flex-col flex-1 min-w-0 max-w-[85%] sm:max-w-[75%]",
                      msg.role === 'user' ? "items-end" : "items-start"
                    )}>
                      {msg.role === 'model' && (
                        <div className="px-1 mb-1.5 flex items-center gap-2">
                          <span className="text-sm font-semibold text-zinc-400">Cortexium</span>
                        </div>
                      )}
                      
                      <div className={cn(
                        "px-5 py-4 rounded-2xl",
                        msg.role === 'user' 
                          ? "bg-blue-600 text-white rounded-tr-none shadow-md" 
                          : msg.isError
                            ? "bg-red-500/10 text-red-400 border border-red-500/20 rounded-tl-none"
                            : "bg-[#18181B] border border-white/10 shadow-md text-zinc-200 rounded-tl-none"
                      )}>
                        {msg.role === 'user' ? (
                          <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                        ) : (
                          <div className={cn(
                            "prose prose-invert prose-sm sm:prose-base max-w-none break-words",
                            msg.isError && "text-red-400"
                          )}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {msg.text || "..."}
                            </ReactMarkdown>
                          </div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isTyping && messages[messages.length - 1]?.role !== 'model' && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex w-full gap-4 sm:gap-6"
                >
                  <div className="shrink-0 w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center mt-1 shadow-sm border bg-[#18181B] border-blue-500/30">
                    <CortexiumLogo className="w-6 h-6" glow={false} />
                  </div>
                  <div className="flex flex-col items-start min-w-0">
                    <div className="px-1 mb-1.5">
                      <span className="text-sm font-semibold text-zinc-400">Cortexium</span>
                    </div>
                    <div className="px-5 py-4 rounded-2xl bg-[#18181B] border border-white/10 shadow-md text-zinc-200 rounded-tl-none flex items-center gap-2 h-[56px]">
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-[bounce_1.4s_infinite_0s] opacity-70"></span>
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-[bounce_1.4s_infinite_0.2s] opacity-70"></span>
                      <span className="w-2 h-2 rounded-full bg-blue-500 animate-[bounce_1.4s_infinite_0.4s] opacity-70"></span>
                    </div>
                  </div>
                </motion.div>
              )}
              <div ref={messagesEndRef} className="h-4" />
            </div>
          )}
        </div>
      </main>

      <footer className="bg-[#0A0A0B]/80 backdrop-blur-md border-t border-white/5 p-4 sm:p-6 shrink-0 relative z-10 w-full">
        <div className="max-w-4xl mx-auto relative">
          <form 
            onSubmit={handleSubmit}
            className="relative flex items-end gap-2 bg-[#18181B] rounded-2xl border border-white/10 shadow-sm focus-within:ring-2 focus-within:ring-blue-500/30 focus-within:border-blue-500 transition-all overflow-hidden"
          >
            <div className="hidden sm:flex shrink-0 items-center justify-center p-3 text-zinc-500">
              {(() => {
                const Icon = MODE_CONFIG[mode].icon;
                return <Icon className="w-5 h-5" />;
              })()}
            </div>
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={`Ask Cortexium anything (${MODE_CONFIG[mode].name} Mode)...`}
              className="flex-1 max-h-48 min-h-[56px] py-4 px-4 sm:px-0 bg-transparent text-white placeholder-zinc-500 resize-none outline-none leading-relaxed"
              rows={1}
            />
            <div className="shrink-0 p-2">
              <button
                type="submit"
                disabled={!input.trim() || isTyping}
                className="flex items-center justify-center w-10 h-10 rounded-xl bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 disabled:hover:bg-blue-600 transition-colors shadow-sm"
              >
                <Send className="w-5 h-5 ml-0.5" />
              </button>
            </div>
          </form>
          <div className="text-center mt-3">
            <span className="text-xs text-zinc-600 font-medium">Cortexium can make mistakes. Verify important information.</span>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---- LANDING PAGE COMPONENT ----
function StarsBackground() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
      {/* Deep space background */}
      <div className="absolute inset-0 bg-[#05050A]" />
      
      {/* Galaxies/Nebulae */}
      <div className="absolute top-0 left-1/4 w-[800px] h-[800px] bg-indigo-900/20 rounded-full blur-[120px] mix-blend-screen" />
      <div className="absolute bottom-0 right-1/4 w-[600px] h-[600px] bg-purple-900/20 rounded-full blur-[100px] mix-blend-screen" />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1000px] h-[1000px] bg-blue-900/10 rounded-full blur-[150px] mix-blend-screen" />

      {/* Stars - using a simple SVG pattern */}
      <svg className="absolute inset-0 w-full h-full opacity-30" xmlns="http://www.w3.org/2000/svg">
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <pattern id="stars" x="0" y="0" width="100" height="100" patternUnits="userSpaceOnUse">
          <circle cx="10" cy="10" r="1.5" fill="#FFF" filter="url(#glow)" opacity="0.8"/>
          <circle cx="50" cy="50" r="1" fill="#FFF" opacity="0.6"/>
          <circle cx="80" cy="20" r="0.5" fill="#FFF" opacity="0.4"/>
          <circle cx="30" cy="80" r="2" fill="#E0E7FF" filter="url(#glow)" opacity="0.9"/>
          <circle cx="90" cy="90" r="1" fill="#FFF" opacity="0.5"/>
          <circle cx="70" cy="60" r="1.5" fill="#C7D2FE" opacity="0.7"/>
          <circle cx="20" cy="40" r="0.5" fill="#FFF" opacity="0.3"/>
        </pattern>
        <rect x="0" y="0" width="100%" height="100%" fill="url(#stars)" />
      </svg>
      
      {/* Different sizes of stars to create parallax-like depth */}
      <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
        <pattern id="stars-sm" x="0" y="0" width="150" height="150" patternUnits="userSpaceOnUse">
          <circle cx="25" cy="25" r="0.8" fill="#FFF" />
          <circle cx="75" cy="125" r="1.2" fill="#FFF" />
          <circle cx="125" cy="75" r="0.5" fill="#FFF" />
          <circle cx="140" cy="10" r="1" fill="#FFF" />
          <circle cx="10" cy="140" r="1.5" fill="#A5B4FC" />
        </pattern>
        <rect x="0" y="0" width="100%" height="100%" fill="url(#stars-sm)" />
      </svg>
    </div>
  );
}

function LandingPage({ onStart, onStartChat, user }: { onStart: () => void, onStartChat?: () => void, user: FirebaseUser | null }) {
  return (
    <div className="min-h-screen relative bg-transparent text-zinc-100 font-sans selection:bg-blue-500/30 selection:text-blue-100">
      <StarsBackground />
      
      {/* Navigation */}
      <nav className="border-b border-white/5 bg-[#0F0F11]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CortexiumLogo className="w-8 h-8" />
            <span className="text-xl font-bold tracking-tight text-white">Cortexium</span>
          </div>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-zinc-400">
            <a href="#features" className="hover:text-white transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-white transition-colors">How it Works</a>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <div className="hidden sm:flex items-center gap-3 mr-4 text-sm">
                 <span className="text-zinc-400">Hi, {user.displayName?.split(' ')[0] || 'Learner'}</span>
                 <button onClick={logout} className="text-zinc-500 hover:text-white transition-colors">Sign Out</button>
              </div>
            ) : (
              <button onClick={loginWithGoogle} className="text-sm font-semibold text-zinc-300 hover:text-white mr-4 transition-colors">Sign In</button>
            )}
            {onStartChat && (
              <button 
                onClick={onStartChat}
                className="hidden sm:flex items-center gap-1.5 text-zinc-300 px-4 py-2 rounded-full text-sm font-semibold hover:text-white hover:bg-white/5 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-blue-500" />
                AI Tutor
              </button>
            )}
            <button 
              onClick={onStart}
              className="bg-zinc-100 text-zinc-900 px-5 py-2 rounded-full text-sm font-semibold hover:bg-white transition-transform active:scale-95"
            >
              Start Learning
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="relative pt-24 pb-32 overflow-hidden">
        {/* Glow Effects */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[500px] bg-blue-600/20 blur-[120px] rounded-full pointer-events-none" />
        
        <div className="max-w-7xl mx-auto px-6 relative z-10 grid lg:grid-cols-2 gap-16 items-center">
          <div className="flex flex-col items-start gap-8 text-left max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-sm font-medium">
              <Sparkles className="w-4 h-4" />
              <span>AI-Powered Study Assistant</span>
            </div>
            
            <h1 className="text-5xl md:text-7xl font-extrabold tracking-tight text-white leading-[1.1]">
              Learn Smarter <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-emerald-400">with AI</span>
            </h1>
            
            <p className="text-xl text-zinc-400 leading-relaxed">
              Your personal AI tutor that explains, summarizes, and quizzes you instantly. Stop wasting time searching. Just ask Cortexium.
            </p>
            
            <div className="flex flex-col sm:flex-row flex-wrap items-center gap-4 w-full">
              <button 
                onClick={onStart}
                className="w-full sm:w-auto flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-600/25 shrink-0"
              >
                Select Class
                <ArrowRight className="w-5 h-5" />
              </button>
              {onStartChat && (
                <button 
                  onClick={onStartChat}
                  className="w-full sm:w-auto flex items-center justify-center gap-2 bg-[#18181B] border border-white/10 hover:bg-white/5 text-white px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm shrink-0"
                >
                  <Sparkles className="w-5 h-5 text-blue-400" />
                  AI Tutor
                </button>
              )}
              <a 
                href="#how-it-works"
                className="w-full sm:w-auto flex items-center justify-center px-8 py-4 rounded-xl font-semibold text-zinc-300 hover:text-white hover:bg-white/5 transition-colors shrink-0"
              >
                See How It Works
              </a>
            </div>

            <div className="flex items-center gap-4 mt-4 pt-4 border-t border-white/5 text-sm text-zinc-500 font-medium">
              <div className="flex -space-x-2">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="w-8 h-8 rounded-full border-2 border-[#0A0A0B] bg-zinc-800 flex items-center justify-center text-[10px]">
                    <User className="w-4 h-4 text-zinc-500" />
                  </div>
                ))}
              </div>
              <p>Trusted by smart students worldwide.</p>
            </div>
          </div>

          {/* Hero App Preview */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="relative lg:h-[600px] w-full rounded-2xl border border-white/10 bg-[#121214] overflow-hidden shadow-2xl flex flex-col"
          >
            {/* Mockup Header */}
            <div className="flex items-center px-4 py-3 border-b border-white/5 bg-[#0F0F11]">
              <div className="flex gap-1.5">
                <div className="w-3 h-3 rounded-full bg-red-500/20 border border-red-500/50" />
                <div className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/50" />
                <div className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/50" />
              </div>
              <div className="mx-auto bg-white/5 rounded-md px-24 py-1.5 text-xs text-zinc-500 flex items-center gap-2">
                <CortexiumLogo className="w-3 h-3" glow={false} /> cortexium.ai
              </div>
            </div>
            {/* Mockup Content */}
            <div className="flex-1 p-6 flex flex-col gap-4 overflow-hidden relative">
               <div className="flex items-start gap-4">
                 <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center"><User className="w-4 h-4" /></div>
                 <div className="bg-blue-600 text-white p-4 rounded-2xl rounded-tl-none max-w-[80%] text-sm">Explain how Neural Networks work, but like I'm 5 years old.</div>
               </div>
               <div className="flex items-start gap-4">
                 <div className="w-8 h-8 rounded-full bg-[#18181B] border border-blue-500/30 flex items-center justify-center shadow-lg shadow-blue-500/20"><CortexiumLogo className="w-5 h-5" glow={false} /></div>
                 <div className="bg-[#18181B] border border-white/5 text-zinc-300 p-4 rounded-2xl rounded-tl-none max-w-[90%] text-sm leading-relaxed space-y-3">
                   <p>Imagine your brain is a giant team of tiny workers trying to solve a puzzle. 🧩</p>
                   <ul className="list-disc pl-4 space-y-1 text-zinc-400">
                     <li><strong className="text-zinc-200">The First Workers:</strong> They look at the edges.</li>
                     <li><strong className="text-zinc-200">The Middle Workers:</strong> They sort the colors.</li>
                     <li><strong className="text-zinc-200">The Boss:</strong> Looks at everyone's work and says "It's a cat!"</li>
                   </ul>
                   <p>A Neural Network is just a computer program doing the exact same thing!</p>
                 </div>
               </div>
               
               {/* Gradient overlay to simulate bottom cutoff */}
               <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[#121214] to-transparent" />
            </div>
          </motion.div>
        </div>
      </section>

      {/* Trust Section - Optional / Minimal */}
      <section className="py-10 border-y border-white/5 bg-white/[0.02]">
        <div className="max-w-7xl mx-auto px-6 text-center">
          <p className="text-zinc-500 font-medium text-sm tracking-wide uppercase">Replaces hours of searching with instant, structured answers</p>
        </div>
      </section>

      {/* Features Section */}
      <section id="features" className="py-32 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center max-w-3xl mx-auto mb-20">
            <h2 className="text-3xl md:text-5xl font-bold tracking-tight text-white mb-6">Everything you need to <span className="text-blue-400">ace your study session</span></h2>
            <p className="text-lg text-zinc-400">Cortexium adapts to how you want to learn. Just pick a mode.</p>
          </div>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            <div className="group bg-[#121214] border border-white/5 p-8 rounded-3xl hover:bg-white/[0.03] hover:border-white/10 transition-all duration-300 hover:-translate-y-1">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800 flex items-center justify-center mb-6 text-white group-hover:scale-110 transition-transform">
                <MessageSquare className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">AI Chat</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">Ask any question and get instant answers like having a personal tutor available 24/7.</p>
            </div>
            
            <div className="group bg-[#121214] border border-white/5 p-8 rounded-3xl hover:bg-white/[0.03] hover:border-white/10 transition-all duration-300 hover:-translate-y-1">
               <div className="w-12 h-12 rounded-2xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Lightbulb className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Explain Mode</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">Break down complex topics into simple, step-by-step concepts anyone can understand.</p>
            </div>
            
            <div className="group bg-[#121214] border border-white/5 p-8 rounded-3xl hover:bg-white/[0.03] hover:border-white/10 transition-all duration-300 hover:-translate-y-1">
               <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Summary Mode</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">Turn massive walls of text or long notes into quick, easy-to-read study summaries.</p>
            </div>

            <div className="group bg-[#121214] border border-white/5 p-8 rounded-3xl hover:bg-white/[0.03] hover:border-white/10 transition-all duration-300 hover:-translate-y-1">
               <div className="w-12 h-12 rounded-2xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <CheckSquare className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-white mb-3">Quiz Mode</h3>
              <p className="text-zinc-400 leading-relaxed text-sm">Test your knowledge. AI generates questions instantly to ensure you actually learned it.</p>
            </div>
          </div>
        </div>
      </section>

      {/* How it Works / Value Prop */}
      <section id="how-it-works" className="py-24 bg-[#0F0F11] border-y border-white/5 relative overflow-hidden">
         <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-20 items-center">
            <div>
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-white mb-8">Study smarter, not harder.</h2>
              <div className="space-y-8">
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-lg border border-blue-500/30">1</div>
                  <div>
                    <h4 className="text-xl font-semibold text-white mb-2">Ask</h4>
                    <p className="text-zinc-400">Type your question, topic, or paste your notes into the chat.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-lg border border-emerald-500/30">2</div>
                  <div>
                    <h4 className="text-xl font-semibold text-white mb-2">Learn</h4>
                    <p className="text-zinc-400">Get clear, structured explanations instantly without sifting through Google results.</p>
                  </div>
                </div>
                <div className="flex gap-4">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold text-lg border border-purple-500/30">3</div>
                  <div>
                    <h4 className="text-xl font-semibold text-white mb-2">Practice</h4>
                    <p className="text-zinc-400">Reinforce your knowledge instantly with generated quizzes to verify understanding.</p>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="relative">
              <div className="absolute inset-0 bg-blue-500/10 blur-3xl rounded-full" />
              <div className="bg-[#121214] border border-white/10 p-8 rounded-3xl relative z-10 space-y-6">
                <h3 className="text-2xl font-bold text-white">Why Cortexium?</h3>
                <ul className="space-y-4">
                  <li className="flex items-center gap-3 text-zinc-300"><CheckCircle2 className="w-5 h-5 text-blue-400 flex-shrink-0" /> <span className="line-through text-zinc-600 mr-2">Hours of searching</span> Instant answers</li>
                  <li className="flex items-center gap-3 text-zinc-300"><CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0" /> <span className="line-through text-zinc-600 mr-2">Dense textbooks</span> Bite-sized concepts</li>
                  <li className="flex items-center gap-3 text-zinc-300"><CheckCircle2 className="w-5 h-5 text-purple-400 flex-shrink-0" /> <span className="line-through text-zinc-600 mr-2">Passive reading</span> Active quiz-based practice</li>
                </ul>
              </div>
            </div>
         </div>
      </section>

      {/* Final CTA */}
      <section className="py-32 relative text-center px-6">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/20 via-[#0A0A0B] to-[#0A0A0B] pointer-events-none" />
        <div className="max-w-3xl mx-auto relative z-10">
          <h2 className="text-4xl md:text-6xl font-bold text-white mb-6 tracking-tight">Start learning smarter today</h2>
          <p className="text-xl text-zinc-400 mb-10 w-full max-w-xl mx-auto">Join the future of education. A personalized tutor is waiting to help you.</p>
          <button 
            onClick={onStart}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-10 py-5 rounded-2xl font-bold text-lg mx-auto transition-all hover:scale-[1.02] active:scale-[0.98] shadow-lg shadow-blue-600/25"
          >
            👉 Try Cortexium Now
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5 py-12 bg-[#0A0A0B]">
        <div className="max-w-7xl mx-auto px-6 flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2">
            <CortexiumLogo className="w-6 h-6" />
            <span className="text-lg font-bold text-white">Cortexium</span>
            <span className="text-zinc-600 ml-2 lg:inline hidden">| AI-powered learning assistant</span>
          </div>
          <div className="flex gap-6 text-sm text-zinc-500 font-medium">
            <a href="#" className="hover:text-white transition-colors">About</a>
            <a href="#" className="hover:text-white transition-colors">Contact</a>
            <a href="#" className="hover:text-white transition-colors">Privacy</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

// ---- INTERACTIVE CLASSROOM COMPONENT ----
function InteractiveClassroom({ onExit, user }: { onExit: () => void; user: FirebaseUser | null }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [boardContent, setBoardContent] = useState<string>('# Welcome to the Interactive Classroom!\n\nI am Cortexium, your AI tutor. Ask me anything, and I will explain it here on the board.');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isTyping]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    const userMessage = input.trim();
    setInput('');
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userMessage }]);
    setIsTyping(true);

    try {
      const groq = getAI();
      const systemPrompt = `You are Cortexium, an AI Study Assistant teaching in an Interactive Classroom.

You need to respond with two parts separated by a special delimiter "|||BOARD_CONTENT|||".
1. The first part is your conversational reply that will show up in the chat window. Keep it short and encouraging.
2. The second part is the detailed Markdown content that will be displayed on the main whiteboard.
CRITICAL: Instead of just formatting text, act like a teacher DRAWING on a board. You MUST use Mermaid.js diagrams to visually draw concepts (flowcharts, mindmaps, architecture diagrams, state diagrams). Keep text minimal and focus heavily on visual drawings. Also use KaTeX for math equations.
WARNING: Ensure your Mermaid syntax is strictly correct. 
- ALL Mermaid diagrams MUST be enclosed in standard Markdown code blocks like \`\`\`mermaid ... \`\`\`.
- ALWAYS use \`-->\` for simple arrows (NO spaces between dashes and bracket).
- ALWAYS use \`-- text -->\` for link text (e.g. \`A -- absorbs --> B\`).
- NEVER use the \`-->|text|\` syntax. It is forbidden.
- ALWAYS use alphanumeric Node IDs without spaces, and attach labels using brackets. e.g. \`NodeA["My Node Text"]\`. 
- NEVER use quoted strings as Node IDs directly (e.g. DO NOT do \`"My Text" --> B\`).
- NEVER put KaTeX math formulas (like $$...$$) inside Mermaid diagrams. Mermaid cannot render them.
- CRITICAL MATH RULE: You MUST wrap ALL mathematical formulas, equations, and variables in KaTeX delimiters. 
  - For standalone equations, use \`$$\` on their own lines: \`$$ E = mc^2 $$\`
  - For inline math, use \`$\`: \`$E = mc^2$\`.
  - NEVER output raw LaTeX equations without \`$\` or \`$$\` wrappers.

Example format:
Here is a visual explanation of photosynthesis!
|||BOARD_CONTENT|||
# Photosynthesis
Here is how it works:
\`\`\`mermaid
graph TD;
    Light-->Chloroplasts;
    Water-->Chloroplasts;
    CO2-->Chloroplasts;
    Chloroplasts-->Oxygen;
    Chloroplasts-->Glucose;
\`\`\`
`;

      const groqMessages: any = [
        { role: "system", content: systemPrompt },
        ...messages.map(m => ({ role: m.role === 'model' ? 'assistant' : 'user', content: m.text })),
        { role: "user", content: userMessage }
      ];

      const completion = await groq.chat.completions.create({
        messages: groqMessages,
        model: "openai/gpt-oss-20b",
        temperature: 0.7,
      });

      const responseText = completion.choices[0]?.message?.content || "I'm sorry, I couldn't process that.";
      const parts = responseText.split('|||BOARD_CONTENT|||');
      
      const chatReply = parts[0]?.trim() || "Here's what I came up with.";
      const boardNewContent = parts[1]?.trim();

      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: chatReply }]);
      if (boardNewContent) {
        setBoardContent(boardNewContent);
      }
    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Sorry, I encountered an error. Please try again.", isError: true }]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div className="h-screen w-full bg-[#0A0A0B] flex flex-col font-sans overflow-hidden text-zinc-100">
      {/* Header */}
      <header className="h-14 border-b border-white/5 bg-[#0F0F11] flex items-center justify-between px-4 shrink-0">
        <div className="flex items-center gap-3">
          <button 
            onClick={onExit}
            className="p-1.5 hover:bg-white/5 rounded-lg text-zinc-400 transition-colors"
          >
            <ArrowRight className="w-5 h-5 rotate-180" />
          </button>
          <div className="flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-blue-400" />
            <h1 className="font-semibold text-white">Interactive Classroom</h1>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-blue-400 bg-blue-500/10 px-3 py-1 rounded-full border border-blue-500/20">Live Session</span>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden flex-col md:flex-row">
        
        {/* Chat Sidebar (Left) */}
        <div className="w-full md:w-80 lg:w-96 border-b md:border-b-0 md:border-r border-white/5 bg-[#0F0F11] flex flex-col h-[50vh] md:h-auto shrink-0">
           {/* Chat Messages */}
           <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
             <div className="text-center p-4">
                <CortexiumLogo className="w-10 h-10 mx-auto mb-3 opacity-80" glow={false} />
                <h3 className="text-white font-medium mb-1">Cortexium AI Tutor</h3>
                <p className="text-sm text-zinc-500">Ask a question to start learning.</p>
             </div>
             
             {messages.map((msg) => (
                <div key={msg.id} className={cn("flex gap-3 max-w-[90%]", msg.role === 'user' ? "ml-auto flex-row-reverse" : "")}>
                  <div className={cn(
                    "w-8 h-8 shrink-0 rounded-full flex items-center justify-center text-sm",
                    msg.role === 'user' ? "bg-zinc-800 text-white" : "bg-blue-600 text-white"
                  )}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <BrainCircuit className="w-4 h-4" />}
                  </div>
                  <div className={cn(
                    "p-3 rounded-2xl text-sm leading-relaxed",
                    msg.role === 'user' 
                      ? "bg-zinc-800 text-white rounded-tr-sm" 
                      : msg.isError
                        ? "bg-red-500/10 border border-red-500/20 text-red-200 rounded-tl-sm"
                        : "bg-[#1A1A1E] border border-white/5 text-zinc-200 rounded-tl-sm"
                  )}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                  </div>
                </div>
              ))}
              
              {isTyping && (
                <div className="flex gap-3 max-w-[90%]">
                   <div className="w-8 h-8 shrink-0 rounded-full bg-blue-600 flex items-center justify-center">
                    <BrainCircuit className="w-4 h-4 text-white" />
                  </div>
                  <div className="p-4 rounded-2xl rounded-tl-sm bg-[#1A1A1E] border border-white/5 flex gap-1.5 items-center">
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0 }} className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.2 }} className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                    <motion.div animate={{ y: [0, -5, 0] }} transition={{ repeat: Infinity, duration: 0.6, delay: 0.4 }} className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
           </div>

           {/* Chat Input */}
           <div className="p-4 bg-[#0F0F11] border-t border-white/5">
             <form onSubmit={handleSendMessage} className="relative flex items-center">
               <input
                 type="text"
                 value={input}
                 onChange={(e) => setInput(e.target.value)}
                 placeholder="Ask your tutor..."
                 className="w-full bg-[#1A1A1E] border border-white/10 rounded-xl pl-4 pr-12 py-3.5 text-sm text-white placeholder-zinc-500 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                 disabled={isTyping}
               />
               <button
                 type="submit"
                 disabled={!input.trim() || isTyping}
                 className="absolute right-2 p-2 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 disabled:text-zinc-500 text-white rounded-lg transition-colors"
               >
                 <Send className="w-4 h-4" />
               </button>
             </form>
           </div>
        </div>

        {/* Whiteboard / Teaching Area (Right) */}
        <div className="flex-1 overflow-y-auto bg-[#0A0A0B] p-4 md:p-8 custom-scrollbar">
          <div className="max-w-4xl mx-auto">
            <div className="bg-[#121214] border border-white/10 rounded-2xl p-6 md:p-10 min-h-[60vh] shadow-xl relative">
               <div className="absolute top-4 right-4 flex gap-2">
                 <div className="w-3 h-3 rounded-full bg-red-500/80"></div>
                 <div className="w-3 h-3 rounded-full bg-yellow-500/80"></div>
                 <div className="w-3 h-3 rounded-full bg-green-500/80"></div>
               </div>
               <div className="prose prose-invert prose-blue max-w-none prose-headings:font-bold prose-h1:text-3xl mt-4">
                   <ReactMarkdown 
                     remarkPlugins={[remarkGfm, remarkMath]}
                     rehypePlugins={[rehypeKatex]}
                     components={{
                       code({ node, inline, className, children, ...props }: any) {
                         const match = /language-(\w+)/.exec(className || '')
                         if (!inline && match && match[1] === 'mermaid') {
                           return <MermaidChart code={String(children).replace(/\n$/, '')} />
                         }
                         return (
                           <code className={className} {...props}>
                             {children}
                           </code>
                         )
                       }
                     }}
                   >
                     {boardContent}
                   </ReactMarkdown>
               </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

// ---- APP ROUTER / STATE MANAGER ----
type PageState = 'landing' | 'classes' | 'dashboard' | 'chat' | 'interactive-classroom';

export default function App() {
  const [currentPage, setCurrentPage] = useState<PageState>('landing');
  const [selectedClass, setSelectedClass] = useState<string | null>(null);
  
  const [initialPrompt, setInitialPrompt] = useState<string>('');
  const [initialMode, setInitialMode] = useState<Mode>('explain');
  const [user, setUser] = useState<FirebaseUser | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
    });
    return () => unsubscribe();
  }, []);

  const navigateToChat = (prompt?: string, mode?: Mode) => {
    setInitialPrompt(prompt || '');
    setInitialMode(mode || 'explain');
    setCurrentPage('chat');
  };

  if (currentPage === 'chat') {
    return (
      <CortexiumApp 
        onExit={() => setCurrentPage(selectedClass ? 'dashboard' : 'classes')} 
        initialPrompt={initialPrompt}
        initialMode={initialMode}
        user={user}
      />
    );
  }

  if (currentPage === 'interactive-classroom') {
    return (
      <InteractiveClassroom onExit={() => setCurrentPage('classes')} user={user} />
    );
  }

  if (currentPage === 'classes') {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans">
        <header className="px-6 py-4 bg-[#0F0F11] border-b border-white/5 sticky top-0 z-10 flex items-center gap-4">
          <button onClick={() => setCurrentPage('landing')} className="p-2 hover:bg-white/5 rounded-lg text-zinc-400">
            <ArrowRight className="w-5 h-5 rotate-180" />
          </button>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <GraduationCap className="w-5 h-5 text-blue-500" />
            Select Your Grade
          </h1>
        </header>

        <main className="max-w-4xl mx-auto px-6 py-12">
          {/* Interactive Classroom Feature */}
          <div className="mb-16">
            <button
              onClick={() => {
                setCurrentPage('interactive-classroom');
              }}
              className="w-full flex items-center justify-between p-6 sm:p-8 rounded-3xl bg-gradient-to-r from-blue-600/10 to-purple-600/10 border border-blue-500/20 hover:border-blue-500/40 hover:bg-white/[0.02] transition-all text-left group"
            >
              <div className="flex items-center gap-6">
                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/20 to-purple-500/20 flex items-center justify-center border border-white/10 group-hover:scale-105 transition-transform">
                  <Sparkles className="w-8 h-8 text-blue-400" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold text-white mb-2 group-hover:text-blue-400 transition-colors">Interactive Classroom Learning</h2>
                  <p className="text-zinc-400">Join a dynamic, AI-powered interactive environment.</p>
                </div>
              </div>
              <div className="hidden sm:flex items-center gap-2 text-blue-400 font-semibold group-hover:translate-x-2 transition-transform">
                Enter <ArrowRight className="w-5 h-5" />
              </div>
            </button>
          </div>

          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold mb-4">What are you studying?</h2>
            <p className="text-zinc-500">Choose your grade to get personalized notes and test series.</p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {['Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10', 'Grade 11', 'Grade 12', 'College / University', 'Competitive Exams'].map((grade) => (
              <button
                key={grade}
                onClick={() => {
                  setSelectedClass(grade);
                  setCurrentPage('dashboard');
                }}
                className="flex items-center justify-between p-6 rounded-2xl bg-[#121214] border border-white/5 hover:bg-white/5 hover:border-white/10 transition-all text-left group"
              >
                <div>
                  <h3 className="text-xl font-semibold text-white mb-1 group-hover:text-blue-400 transition-colors">{grade}</h3>
                  <span className="text-sm text-zinc-500">Full study materials & tests</span>
                </div>
                <ChevronRight className="text-zinc-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all" />
              </button>
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (currentPage === 'dashboard') {
    return (
      <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans flex flex-col">
        <header className="px-6 py-4 bg-[#0F0F11] border-b border-white/5 sticky top-0 z-10 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => setCurrentPage('classes')} className="p-2 hover:bg-white/5 rounded-lg text-zinc-400">
              <ArrowRight className="w-5 h-5 rotate-180" />
            </button>
            <h1 className="text-xl font-bold text-white flex items-center gap-2">
              <span className="opacity-50">{selectedClass}</span> <ChevronRight className="w-4 h-4 opacity-50" /> Dashboard
            </h1>
          </div>
          <div className="flex items-center gap-4">
            {user ? (
              <div className="hidden sm:flex items-center gap-3 text-sm">
                 <span className="text-zinc-400">{user.displayName?.split(' ')[0]}</span>
                 <button onClick={logout} className="text-zinc-500 hover:text-white transition-colors">Sign Out</button>
              </div>
            ) : (
              <button onClick={loginWithGoogle} className="text-sm font-semibold text-zinc-300 hover:text-white transition-colors">Sign In</button>
            )}
            <button 
              onClick={() => navigateToChat()}
              className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            >
              <Sparkles className="w-4 h-4" /> Open AI Tutor
            </button>
          </div>
        </header>

        <main className="max-w-6xl mx-auto px-6 py-12 flex-1 w-full flex flex-col gap-12">
          
          <section>
             <div className="flex items-center justify-between mb-6">
               <h2 className="text-2xl font-bold flex items-center gap-2">
                <BookOpen className="text-emerald-500 w-6 h-6" /> 
                Subject Notes
               </h2>
             </div>
             
             <div className="grid md:grid-cols-3 gap-6">
                {['Physics & Science', 'Mathematics', 'History & Social Studies'].map(subject => (
                  <div key={subject} className="bg-[#121214] border border-white/5 p-6 rounded-2xl flex flex-col items-start hover:border-emerald-500/30 transition-all hover:-translate-y-1">
                    <h3 className="text-lg font-bold text-white mb-2">{subject}</h3>
                    <p className="text-sm text-zinc-500 mb-6">Detailed notes and smart summaries for all chapters.</p>
                    <button 
                      onClick={() => navigateToChat(`I am in ${selectedClass}. Please provide detailed summary notes for the first chapter of ${subject}.`, 'summary')}
                      className="mt-auto w-full py-2.5 rounded-xl border border-emerald-500/20 text-emerald-400 font-medium hover:bg-emerald-500/10 transition-colors"
                    >
                       Get Notes
                    </button>
                  </div>
                ))}
             </div>
          </section>

          <section>
             <div className="flex items-center justify-between mb-6">
               <h2 className="text-2xl font-bold flex items-center gap-2">
                <Target className="text-purple-500 w-6 h-6" /> 
                Test Series
               </h2>
             </div>
             
             <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
                {(() => {
                  const isJunior = selectedClass === 'Grade 3' || selectedClass === 'Grade 4' || selectedClass === 'Grade 5';
                  const tests = isJunior ? [
                    { name: 'Weekly Mock Test', time: '30 mins', type: 'Mixed Subjects' },
                    { name: 'Number Ninja', time: '15 mins', type: 'Mathematics' },
                    { name: 'Science Explorer', time: '20 mins', type: 'EVS / Science' },
                    { name: 'Language Arts', time: '15 mins', type: 'English' },
                    { name: 'Math Basics', time: '20 mins', type: 'Mathematics' },
                    { name: 'Grammar Quiz', time: '10 mins', type: 'English' },
                    { name: 'Environmental Studies', time: '20 mins', type: 'EVS' },
                    { name: 'Spelling Bee Practice', time: '10 mins', type: 'English' },
                    { name: 'Mental Math', time: '10 mins', type: 'Mathematics' },
                    { name: 'Monthly Junior Mock', time: '40 mins', type: 'All Subjects' },
                  ] : [
                    { name: 'Weekly Mock Test', time: '40 mins', type: 'Mixed Subjects' },
                    { name: 'Math Quiz 1', time: '15 mins', type: 'Algebra' },
                    { name: 'Science Test', time: '20 mins', type: 'Physics' },
                    { name: 'Concept Check', time: '10 mins', type: 'All Subjects' },
                    { name: 'Chemistry Fundamentals', time: '25 mins', type: 'Chemistry' },
                    { name: 'Biology Basics', time: '20 mins', type: 'Biology' },
                    { name: 'History Rapid Fire', time: '15 mins', type: 'History' },
                    { name: 'Geography Map Skills', time: '20 mins', type: 'Geography' },
                    { name: 'Math Geometry', time: '30 mins', type: 'Mathematics' },
                    { name: 'Physics Mechanics', time: '30 mins', type: 'Physics' },
                    { name: 'Literature Review', time: '25 mins', type: 'English' },
                    { name: 'Grammar Advanced', time: '15 mins', type: 'English' },
                    { name: 'Civics & Admin', time: '15 mins', type: 'Social Studies' },
                    { name: 'Grand Mock - 1', time: '60 mins', type: 'All Subjects' },
                    { name: 'Final Semester Mock', time: '90 mins', type: 'All Subjects' },
                  ];

                  return tests.map((test, index) => (
                    <div key={index} className="bg-[#121214] border border-white/5 p-5 rounded-2xl flex flex-col items-start hover:border-purple-500/30 transition-all hover:-translate-y-1">
                      <div className="flex items-center justify-between w-full mb-3">
                        <span className="text-xs font-medium px-2 py-1 bg-purple-500/10 text-purple-400 rounded-md">{test.type}</span>
                        <span className="text-xs text-zinc-500 flex items-center gap-1"><Clock className="w-3 h-3"/> {test.time}</span>
                      </div>
                      <h3 className="font-bold text-white mb-4">{test.name}</h3>
                      <button 
                        onClick={() => navigateToChat(`I am in ${selectedClass}. Let's start the ${test.name} focused on ${test.type}.`, 'quiz')}
                        className="mt-auto w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-medium transition-colors"
                      >
                         Start Test
                      </button>
                    </div>
                  ));
                })()}
             </div>
          </section>

        </main>
      </div>
    );
  }

  return <LandingPage onStart={() => setCurrentPage('classes')} onStartChat={() => navigateToChat()} user={user} />;
}
