/**
 * prospects.js — Future Development Roadmap
 * Rendered in the sidebar of the application.
 */

export const PROSPECTS = [
    {
        phase: "Phase 1 — Core Enhancements",
        icon: "✦",
        items: [
            {
                title: "Multimodal Input",
                desc: "Accept image uploads alongside text — Gemma 4 natively supports vision.",
            },
            {
                title: "Streaming Markdown",
                desc: "Render full CommonMark as it streams: tables, LaTeX math, syntax-highlighted code blocks.",
            },
            {
                title: "Conversation Export",
                desc: "Download full chat history as Markdown, PDF, or JSON.",
            },
            {
                title: "System Prompt Library",
                desc: "Pre-built personas (tutor, lawyer, code reviewer) switchable at runtime.",
            },
        ],
    },
    {
        phase: "Phase 2 — Power Features",
        icon: "◆",
        items: [
            {
                title: "RAG (Retrieval-Augmented Generation)",
                desc: "Upload PDFs / text files. Chunk, embed with a small embedding model, and inject relevant context into each prompt.",
            },
            {
                title: "In-Browser Vector Store",
                desc: "Use IndexedDB + HNSW for persistent, user-owned semantic memory.",
            },
            {
                title: "Multi-Model Switching",
                desc: "Swap between Gemma 4 E2B / E4B, Phi-4 mini, Qwen 2.5, etc. — all in-browser.",
            },
            {
                title: "Voice I/O",
                desc: "Web Speech API for speech-to-text input + TTS output using browser native voices.",
            },
        ],
    },
    {
        phase: "Phase 3 — Ecosystem",
        icon: "◈",
        items: [
            {
                title: "Browser Extension",
                desc: "Chrome/Edge sidebar extension for AI assistance on any webpage — summarise, translate, explain selections.",
            },
            {
                title: "PWA & Offline Mode",
                desc: "Install as a Progressive Web App. Model cached in Cache API for fully offline use.",
            },
            {
                title: "Canvas / Artifacts Mode",
                desc: "AI-generated artifacts (code, documents) open in a live side panel with preview + edit.",
            },
            {
                title: "Collaborative Sessions",
                desc: "WebRTC peer-to-peer sharing of a conversation thread — no server needed.",
            },
        ],
    },
    {
        phase: "Phase 4 — Privacy & Enterprise",
        icon: "⬡",
        items: [
            {
                title: "End-to-End Encrypted Sync",
                desc: "Sync chat history across devices via user-owned storage (S3, R2, or self-hosted) with AES-GCM encryption.",
            },
            {
                title: "Audit Logs & Compliance",
                desc: "Tamper-evident conversation logs, suitable for regulated industries.",
            },
            {
                title: "Fine-Tuning UI",
                desc: "Browser-side LoRA fine-tuning on small datasets using WebGPU for domain specialisation.",
            },
            {
                title: "Agent Framework",
                desc: "Tool-calling loop: give the model access to Calculator, Web Search (local proxy), and Code Interpreter.",
            },
        ],
    },
];
