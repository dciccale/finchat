'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';
import { Streamdown } from 'streamdown';
import 'katex/dist/katex.min.css';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

export default function Home() {
  const [input, setInput] = useState('');
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/chat',
    }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput('');
    }
  };

  return (
    <div className="flex flex-col min-h-screen p-8 pb-20 sm:p-20 font-sans">
      <main className="flex-1 w-full max-w-3xl mx-auto flex flex-col">
        <h1 className="text-2xl font-bold mb-8">AI Chat</h1>
        
        <div className="flex-1 overflow-y-auto mb-4 space-y-4">
          {messages.map((message) => {
            const markdown = message.parts
              .map((part) => (part.type === 'text' ? part.text : ''))
              .join('');
            const isUser = message.role === 'user';
            return (
              <div
                key={message.id}
                className={`p-4 rounded-lg prose dark:prose-invert max-w-none ${
                  isUser
                    ? 'bg-blue-500 text-white ml-auto max-w-[80%]'
                    : 'bg-gray-50 dark:bg-gray-800 border border-gray-200 dark:border-gray-600 mr-auto max-w-[80%]'
                }`}
              >
                <div className="font-semibold mb-2">
                  {isUser ? 'You' : 'AI'}
                </div>
                <div className="markdown-body overflow-x-auto">
                  {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{markdown}</div>
                  ) : (
                    <Streamdown
                      // parse incomplete blocks while streaming for nicer UX
                      parseIncompleteMarkdown
                      allowedImagePrefixes={["*"]}
                      allowedLinkPrefixes={["*"]}
                      className="text-sm leading-relaxed"
                    >
                      {markdown}
                    </Streamdown>
                  )}
                </div>
              </div>
            );
          })}
          
          {status === 'streaming' && (
            <div className="text-gray-500 text-sm">AI is typing...</div>
          )}
        </div>

        <form onSubmit={handleSubmit} className="flex gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask your CFO"
            disabled={status === 'streaming' || status === 'submitted'}
            className='resize-none'
          />
          <Button
            type="submit"
            disabled={!input.trim() || status === 'streaming' || status === 'submitted'}
          >
            Send
          </Button>
        </form>
      </main>
    </div>
  );
}
