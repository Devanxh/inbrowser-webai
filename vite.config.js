import { defineConfig } from 'vite';
import path from 'path';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  // Multi-page app: serve both the chat page and the txt2img page
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/onnxruntime-web/dist/*.wasm',
          dest: 'onnx',
          flatten: true
        }
      ]
    })
  ],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        txt2img: path.resolve(__dirname, 'txt2img.html'),
      },
    },
  },

  // Workers must be ES modules to use top-level import/export
  worker: {
    format: 'es',
  },

  // Do not pre-bundle packages that ship their own chunked ESM builds
  optimizeDeps: {
    exclude: ['web-txt2img', '@xenova/transformers', '@huggingface/transformers', 'onnxruntime-web'],
  },

  // Required CORS headers so browsers allow SharedArrayBuffer usage needed by ONNX/wasm
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
});
