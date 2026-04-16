/**
 * worker.js — In-Browser Inference Web Worker
 * Uses @huggingface/transformers v3 via CDN ESM build.
 *
 * Model: onnx-community/Qwen2.5-0.5B-Instruct (Tiny, fast, fully capable)
 */

let transformers = null;

// ─── Model config ─────────────────────────────────────────────────────────────
const MODEL_ID = "onnx-community/Bonsai-1.7B-ONNX";  // ~350 MB q4
const MODEL_OPTS = { dtype: "q1", device: "webgpu" };

let tokenizer = null;
let model = null;
let stopCriteria = null;

// Wrap initialization in an async function to catch exact import errors
async function initTransformers() {
    try {
        transformers = await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3");
        self.postMessage({ type: "status", data: "Transformers.js loaded." });
    } catch (err) {
        self.postMessage({ type: "error", data: `Failed to import transformers.js: ${err.message ?? String(err)}` });
    }
}
const transformersPromise = initTransformers();


// ─── Aggregate download tracker ───────────────────────────────────────────────
// Transformers.js v3 fires individual file progress events.
// We aggregate loaded/total across all files for one smooth bar.
const fileProgress = {}; // { filename → { loaded, total } }

function aggregateProgress() {
    let loaded = 0, total = 0;
    for (const f of Object.values(fileProgress)) {
        loaded += f.loaded ?? 0;
        total += f.total ?? 0;
    }
    return { loaded, total };
}

function onProgress(info) {
    // Forward raw info so the UI can show fine detail
    self.postMessage({ type: "progress_raw", data: info });

    // Aggregate download progress across all files
    if (info.status === "progress" && info.name) {
        fileProgress[info.name] = { loaded: info.loaded ?? 0, total: info.total ?? 0 };
        const agg = aggregateProgress();
        self.postMessage({ type: "progress_agg", data: agg });
    }

    if (info.status === "ready") {
        self.postMessage({ type: "progress_file_done", data: { name: info.name } });
    }
}

// ─── Load model ──────────────────────────────────────────────────────────────
async function loadModel() {
    if (!transformers) {
        self.postMessage({ type: "error", data: "Transformers.js is not loaded yet." });
        return;
    }
    const { AutoTokenizer, AutoModelForCausalLM } = transformers;

    try {
        self.postMessage({ type: "status", data: "loading_tokenizer" });

        tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, {
            progress_callback: onProgress,
        });

        self.postMessage({ type: "status", data: "loading_model" });

        model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
            ...MODEL_OPTS,
            progress_callback: onProgress,
        });

        self.postMessage({ type: "ready", data: { device: "webgpu" } });

    } catch (err) {
        console.error("[Worker] WebGPU load failed:", err);
        self.postMessage({ type: "status", data: "wasm_fallback" });

        try {
            model = await AutoModelForCausalLM.from_pretrained(MODEL_ID, {
                dtype: "q4",
                device: "wasm",
                progress_callback: onProgress,
            });

            self.postMessage({ type: "ready", data: { device: "wasm" } });

        } catch (err2) {
            self.postMessage({ type: "error", data: err2.message ?? String(err2) });
        }
    }
}

// ─── Generate ────────────────────────────────────────────────────────────────
async function generate(messages) {
    if (!model || !tokenizer || !transformers) {
        self.postMessage({ type: "error", data: "Model not loaded yet." });
        return;
    }
    const { TextStreamer } = transformers;

    // Build prompt
    const inputs = tokenizer.apply_chat_template(messages, {
        add_generation_prompt: true,
        return_dict: true,
        tokenize: true,
        return_tensors: "pt",
    });

    let generatedText = "";

    const streamer = new TextStreamer(tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text) => {
            generatedText += text;
            self.postMessage({ type: "token", data: text });
        },
    });

    try {
        await model.generate({
            ...inputs,
            max_new_tokens: 1024,
            do_sample: true,
            temperature: 0.7,
            top_p: 0.9,
            repetition_penalty: 1.1,
            streamer,
        });
        self.postMessage({ type: "done", data: generatedText });

    } catch (err) {
        const msg = err?.message ?? String(err);
        if (msg.toLowerCase().includes("interrupt")) {
            self.postMessage({ type: "aborted" });
        } else {
            self.postMessage({ type: "error", data: msg });
        }
    }
}

// ─── Message router ──────────────────────────────────────────────────────────
self.addEventListener("message", async ({ data: { type, data } }) => {
    if (type === "load") { 
        await transformersPromise;
        loadModel(); 
    }
    else if (type === "generate") generate(data.messages);
    else if (type === "abort") {
        // Model interrupt can be tricky inside a worker, omitted for stability.
    }
});
