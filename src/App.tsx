import React, { useState, useEffect, useRef } from 'react';
import { Upload, Settings, MessageSquare, X, Send, Bot, User } from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import { Document, Page, pdfjs } from 'react-pdf';
import Markdown from 'react-markdown';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Initialize pdfjs worker
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

type Message = {
  id: string;
  role: 'user' | 'ai';
  content: string;
  context?: string;
};

type AIConfig = {
  model: string;
  systemInstruction: string;
  temperature: number;
};

export default function App() {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [selectedText, setSelectedText] = useState<string>('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  
  const [aiConfig, setAiConfig] = useState<AIConfig>({
    model: 'gemini-3-flash-preview',
    systemInstruction: 'You are a helpful assistant that answers questions based on the provided context from a document. If the answer is not in the context, say so.',
    temperature: 0.7,
  });

  const chatEndRef = useRef<HTMLDivElement>(null);
  const pdfContainerRef = useRef<HTMLDivElement>(null);
  const chatInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim() !== '') {
        // Check if selection is within the PDF container
        if (pdfContainerRef.current && pdfContainerRef.current.contains(selection.anchorNode)) {
          setSelectedText(selection.toString().trim());
          // Optional: focus the input when text is selected
          // chatInputRef.current?.focus();
        }
      }
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    return () => document.removeEventListener('selectionchange', handleSelectionChange);
  }, []);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type === 'application/pdf') {
      setPdfFile(file);
      setMessages([]);
      setSelectedText('');
    }
  };

  const handleSendMessage = async () => {
    if (!input.trim() && !selectedText) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      context: selectedText,
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      
      let prompt = '';
      if (userMessage.context) {
        prompt += `Context from document:\n"""\n${userMessage.context}\n"""\n\n`;
      }
      prompt += `User Question: ${userMessage.content}`;

      const response = await ai.models.generateContent({
        model: aiConfig.model,
        contents: prompt,
        config: {
          systemInstruction: aiConfig.systemInstruction,
          temperature: aiConfig.temperature,
        },
      });

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: response.text || 'Sorry, I could not generate a response.',
      };

      setMessages((prev) => [...prev, aiMessage]);
    } catch (error) {
      console.error('Error generating AI response:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'ai',
        content: 'Sorry, there was an error communicating with the AI. Please check your API key and try again.',
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-full bg-zinc-50 text-zinc-900 font-sans overflow-hidden">
      {/* Left Panel: PDF Viewer */}
      <div className="flex-1 flex flex-col border-r border-zinc-200 bg-white relative">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-4 bg-white z-10">
          <h1 className="font-semibold text-lg flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-600" />
            PDF AI Chat
          </h1>
          <div className="flex items-center gap-2">
            <label className="cursor-pointer bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2">
              <Upload className="w-4 h-4" />
              Upload PDF
              <input type="file" accept="application/pdf" className="hidden" onChange={handleFileUpload} />
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-auto bg-zinc-100 relative" ref={pdfContainerRef}>
          {!pdfFile ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center text-zinc-500">
              <Upload className="w-12 h-12 mb-4 text-zinc-300" />
              <p className="text-lg font-medium">No PDF loaded</p>
              <p className="text-sm">Upload a PDF to start reading and chatting</p>
            </div>
          ) : (
            <div className="flex justify-center p-4">
              <Document
                file={pdfFile}
                onLoadSuccess={({ numPages }) => setNumPages(numPages)}
                className="flex flex-col gap-4"
                loading={
                  <div className="flex items-center justify-center p-12 text-zinc-500">
                    Loading PDF...
                  </div>
                }
              >
                {Array.from(new Array(numPages), (el, index) => (
                  <div key={`page_${index + 1}`} className="bg-white shadow-sm rounded-sm overflow-hidden">
                    <Page
                      pageNumber={index + 1}
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="max-w-full"
                      width={800}
                    />
                  </div>
                ))}
              </Document>
            </div>
          )}
        </div>
      </div>

      {/* Right Panel: Chat Interface */}
      <div className="w-96 flex flex-col bg-white shadow-[-4px_0_24px_rgba(0,0,0,0.02)] z-20">
        <div className="h-14 border-b border-zinc-200 flex items-center justify-between px-4">
          <h2 className="font-medium">AI Assistant</h2>
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="p-1.5 text-zinc-500 hover:text-zinc-900 hover:bg-zinc-100 rounded-md transition-colors"
            title="AI Settings"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-zinc-500 space-y-3">
              <Bot className="w-10 h-10 text-zinc-300" />
              <p className="text-sm">
                Select text in the PDF to use it as context, then ask me a question!
              </p>
            </div>
          ) : (
            messages.map((msg) => (
              <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`flex items-start gap-2 max-w-[90%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-600' : 'bg-zinc-100 text-zinc-600'}`}>
                    {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </div>
                  <div className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                    {msg.context && (
                      <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs p-2 rounded-md max-w-full overflow-hidden text-ellipsis line-clamp-3">
                        <span className="font-semibold block mb-1">Context:</span>
                        "{msg.context}"
                      </div>
                    )}
                    <div className={`px-4 py-2 rounded-2xl text-sm ${
                      msg.role === 'user'
                        ? 'bg-indigo-600 text-white rounded-tr-sm'
                        : 'bg-zinc-100 text-zinc-900 rounded-tl-sm'
                    }`}>
                      {msg.role === 'ai' ? (
                        <div className="prose prose-sm max-w-none prose-zinc">
                          <Markdown>{msg.content}</Markdown>
                        </div>
                      ) : (
                        msg.content
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
          {isLoading && (
            <div className="flex items-start gap-2">
              <div className="w-8 h-8 rounded-full bg-zinc-100 text-zinc-600 flex items-center justify-center shrink-0">
                <Bot className="w-4 h-4" />
              </div>
              <div className="bg-zinc-100 text-zinc-900 px-4 py-3 rounded-2xl rounded-tl-sm text-sm flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                <div className="w-1.5 h-1.5 bg-zinc-400 rounded-full animate-bounce"></div>
              </div>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div className="p-4 bg-white border-t border-zinc-200">
          {selectedText && (
            <div className="mb-3 flex items-start justify-between bg-amber-50 border border-amber-200 rounded-md p-2">
              <div className="text-xs text-amber-900 line-clamp-2 pr-2">
                <span className="font-semibold">Selected: </span>
                "{selectedText}"
              </div>
              <button
                onClick={() => setSelectedText('')}
                className="text-amber-700 hover:text-amber-900 shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
          <div className="relative flex items-center">
            <textarea
              ref={chatInputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage();
                }
              }}
              placeholder="Ask a question..."
              className="w-full bg-zinc-100 border-transparent focus:bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 rounded-xl pl-4 pr-12 py-3 text-sm resize-none outline-none transition-all"
              rows={1}
              style={{ minHeight: '44px', maxHeight: '120px' }}
            />
            <button
              onClick={handleSendMessage}
              disabled={(!input.trim() && !selectedText) || isLoading}
              className="absolute right-2 p-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:hover:bg-indigo-600 transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-200">
              <h3 className="font-semibold text-lg">AI Configuration</h3>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="text-zinc-500 hover:text-zinc-900"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">Model</label>
                <select
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="gemini-3-flash-preview">Gemini 3 Flash</option>
                  <option value="gemini-3.1-pro-preview">Gemini 3.1 Pro</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">System Instruction</label>
                <textarea
                  value={aiConfig.systemInstruction}
                  onChange={(e) => setAiConfig({ ...aiConfig, systemInstruction: e.target.value })}
                  className="w-full border border-zinc-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 h-24 resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-zinc-700 mb-1">
                  Temperature: {aiConfig.temperature}
                </label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiConfig.temperature}
                  onChange={(e) => setAiConfig({ ...aiConfig, temperature: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
            <div className="p-4 border-t border-zinc-200 bg-zinc-50 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="bg-indigo-600 text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-indigo-700 transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
