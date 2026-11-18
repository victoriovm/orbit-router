"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/shared/components";

export default function PiUpdateButton() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const requestRef = useRef(null);

  useEffect(() => () => requestRef.current?.abort(), []);

  const updatePi = async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const response = await fetch("/api/oauth/openai-chatgpt/pi-update", {
        method: "POST",
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok || !data.installed) throw new Error(data.error || "Failed to update Pi.");
      if (!controller.signal.aborted) setSuccess(`Pi updated${data.version ? ` (${data.version})` : ""}.`);
    } catch (err) {
      if (!controller.signal.aborted) setError(err.message);
    } finally {
      if (!controller.signal.aborted) {
        requestRef.current = null;
        setLoading(false);
      }
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <Button size="sm" variant="secondary" icon="system_update" loading={loading} onClick={updatePi}>
        {loading ? "Updating Pi..." : "Update Pi"}
      </Button>
      {error && <p role="alert" className="text-xs text-red-500">{error}</p>}
      {success && <p role="status" className="text-xs text-green-600">{success}</p>}
    </div>
  );
}
