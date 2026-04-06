"use client";

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { KeyRound, Eye, EyeOff } from "lucide-react";

interface ApiKeyFormProps {
  onKeysSet: (keys: {
    anthropicKey: string;
    braveSearchKey: string;
  }) => void;
}

export function ApiKeyForm({ onKeysSet }: ApiKeyFormProps) {
  const [anthropicKey, setAnthropicKey] = useState("");
  const [braveSearchKey, setBraveSearchKey] = useState("");
  const [showKeys, setShowKeys] = useState(false);

  useEffect(() => {
    const saved = sessionStorage.getItem("medscout-keys");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setAnthropicKey(parsed.anthropicKey || "");
        setBraveSearchKey(parsed.braveSearchKey || "");
        if (parsed.anthropicKey && parsed.braveSearchKey) {
          onKeysSet(parsed);
        }
      } catch {
        // ignore
      }
    }
  }, [onKeysSet]);

  const handleSave = () => {
    const keys = { anthropicKey, braveSearchKey };
    sessionStorage.setItem("medscout-keys", JSON.stringify(keys));
    onKeysSet(keys);
  };

  const allFilled = anthropicKey && braveSearchKey;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <KeyRound className="h-5 w-5" />
          API Keys
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Keys are stored in your browser session only and never sent to our
          servers. They are forwarded directly to Anthropic and Brave APIs.
        </p>

        <div className="space-y-2">
          <Label htmlFor="anthropic-key">Anthropic API Key</Label>
          <Input
            id="anthropic-key"
            type={showKeys ? "text" : "password"}
            placeholder="sk-ant-..."
            value={anthropicKey}
            onChange={(e) => setAnthropicKey(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="brave-key">Brave Search API Key</Label>
          <Input
            id="brave-key"
            type={showKeys ? "text" : "password"}
            placeholder="BSA..."
            value={braveSearchKey}
            onChange={(e) => setBraveSearchKey(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Get one at{" "}
            <a
              href="https://brave.com/search/api/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              brave.com/search/api
            </a>
            {" "}&mdash; 2,000 free queries/month
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={!allFilled}>
            Save Keys
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowKeys(!showKeys)}
          >
            {showKeys ? (
              <EyeOff className="h-4 w-4 mr-1" />
            ) : (
              <Eye className="h-4 w-4 mr-1" />
            )}
            {showKeys ? "Hide" : "Show"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
