"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState } from "react";
import { Streamdown } from "streamdown";
import "katex/dist/katex.min.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

export default function Home() {
  const [input, setInput] = useState("");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim()) {
      sendMessage({ text: input });
      setInput("");
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col h-[70dvh]">
        <CardContent className="flex flex-col flex-1 overflow-hidden p-4">
          <div className="flex-1 overflow-y-auto space-y-4 pr-1">
            {messages.map((message) => {
              const markdown = message.parts
                .map((part) => (part.type === "text" ? part.text : ""))
                .join("");
              const isUser = message.role === "user";
              return (
                <div
                  key={message.id}
                  className={`group relative max-w-[80%] rounded-lg border px-4 py-3 text-sm shadow-sm transition-colors ${
                    isUser
                      ? "ml-auto bg-primary text-primary-foreground border-primary/60"
                      : "mr-auto bg-muted/40 dark:bg-muted/30"
                  }`}
                >
                  <div className="font-medium mb-1 text-xs opacity-70 tracking-wide uppercase">
                    {isUser ? "You" : "AI"}
                  </div>
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    {isUser ? (
                      <div className="whitespace-pre-wrap break-words leading-relaxed">
                        {markdown}
                      </div>
                    ) : (
                      <Streamdown
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
            {status === "streaming" && (
              <div className="text-xs text-muted-foreground">
                AI is typing...
              </div>
            )}
          </div>
          <form onSubmit={handleSubmit} className="mt-4 flex gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask your CFO"
              disabled={status === "streaming" || status === "submitted"}
              className="resize-none min-h-14"
            />
            <Button
              type="submit"
              className="self-end"
              disabled={
                !input.trim() ||
                status === "streaming" ||
                status === "submitted"
              }
            >
              Send
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
