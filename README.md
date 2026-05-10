# 🐾 Catog Automation

### The AI-First Desktop Orchestration Framework

![Status: macOS Only](https://img.shields.io/badge/Platform-macOS%20Only-blue?style=for-the-badge&logo=apple)
![Status: Alpha](https://img.shields.io/badge/Status-Alpha-orange?style=for-the-badge)

![Catog Hero](https://images.unsplash.com/photo-1550751827-4bd374c3f58b?auto=format&fit=crop&q=80&w=1200&h=400)

> [!IMPORTANT]
> **Catog Automation** is a high-performance, cross-platform desktop automation system built with Rust and Tauri. It enables autonomous AI agents to interact with any application through natural language, visual grounding, and direct system manipulation.

---

## 🚀 Key Features

### 🧠 Autonomous Orchestration
- **Visual Grounding**: Integrates with Vision models (Qwen-VL) to "see" and interpret GUI elements in real-time.
- **Natural Language Control**: Parse complex human intents into multi-step automation sequences.


### 🎮 Precision Control
- **Input Simulation**: Pixel-perfect mouse movements and keyboard automation with human-like jitter and delays.
- **Window Management**: Complete control over window state, dimensions, and positioning across multiple displays.
- **UI Automation**: Native integration with macOS Accessibility API (Windows UI Automation and Linux AT-SPI support coming soon).

### ⚡ Performance Optimized
- **AMD MI300X Native**: Deeply optimized for AMD MI300X GPUs using ROCm and vLLM.
- **MTP Speculative Decoding**: Extreme inference speeds for real-time agentic responses.
- **Low Latency**: Built with Rust for near-zero overhead system interactions.

---

## 🏗️ Architecture

```mermaid
graph TD
    A[User / AI Agent] -->|Natural Language| B(Tauri Frontend)
    B -->|IPC| C{Rust Core}
    C -->|Automation API| D[OS Layer]
    C -->|vLLM API| E[AI Engine - MI300X]
    D -->|Control| F[Target Applications]
    E -->|Vision/Code| C
```

---

## 🛠️ Getting Started

### Prerequisites
- **OS**: macOS 13+ (Windows and Linux support in development)
- **Rust**: 1.75+
- **Node.js**: 20+
- **Hardware**: Recommended NVIDIA or AMD GPU for local inference (Optimized for MI300X)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/Zrald1/catog-automation.git
   cd catog-automation/MainSoftware/catog-automation
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start Development Mode**
   ```bash
   npm run tauri dev
   ```

---

## 🤖 AI Backend Setup (AMD MI300X Optimized)

Catog Automation is designed for extreme-speed dual-model orchestration. Use the following optimized deployment script to launch your backend:

```bash
#!/bin/bash

# --- Global Optimizations for MI300X (192GB VRAM) ---
export HF_TOKEN="<YOUR_HF_ACCESS_TOKEN>"
export VLLM_SLEEP_WHEN_IDLE=1
export VLLM_USE_DEEP_GEMM=0
export VLLM_USE_FLASHINFER_MOE_FP16=1
export VLLM_USE_FLASHINFER_SAMPLER=0
export VLLM_ROCM_USE_AITER=1
export VLLM_ROCM_USE_AITER_FP4BMM=0 
export HIP_FORCE_DEV_KERNARG=1
export OMP_NUM_THREADS=4

# --- OS Level Tweaks ---
# Disable NUMA balancing to prevent latency spikes in real-time loops
# sudo sysctl -w kernel.numa_balancing=0

echo "Starting Real-Time Vision Assistant on Port 8000..."
# --- Instance 1: Vision Assistant (Real-Time GUI Grounding) ---
# Utilizing 0.15 (~28.8GB VRAM)
OMP_NUM_THREADS=1 vllm serve Qwen/Qwen3-VL-2B-Instruct \
    --host 0.0.0.0 \
    --port 8000 \
    --dtype bfloat16 \
    --gpu-memory-utilization 0.15 \
    --max-model-len 32768 \
    --kv-cache-dtype fp8 \
    --limit-mm-per-prompt '{"image": 2}' \
    --mm-processor-cache-gb 4 \
    --trust-remote-code &

# Wait for vision model to initialize before starting the heavy coder
sleep 30

echo "Starting Extreme Speed Coder on Port 30000..."
# --- Instance 2: Extreme Speed Coding Flagship ---
# Utilizing 0.75 (~144GB VRAM) | Total VRAM usage: 90%
vllm serve amd/Qwen3.5-35B-A3B-MXFP4 \
    --host 0.0.0.0 \
    --port 30000 \
    --quantization quark \
    --gpu-memory-utilization 0.55 \
    --max-model-len 32768 \
    --tensor-parallel-size 1 \
    --enable-expert-parallel \
    --enable-prefix-caching \
    --enable-auto-tool-choice \
    --tool-call-parser qwen3_coder \
    --reasoning-parser qwen3 \
    --kv-cache-dtype fp8 \
    --enable-chunked-prefill \
    --trust-remote-code
```

---
OPTIONAL INTEGRATION OF OMNIPARSER 
# 🚀 Complete Installation Workflow

Here is the finalized, correct sequence of steps that resulted in your successful deployment:

---

## 1. Environment Setup & PyTorch Install
First, we bypassed the Conda ToS, created an isolated Python 3.12 environment, and installed the ROCm-specific version of PyTorch to ensure compatibility with your MI300X.

```bash
conda tos accept --override-channels --channel https://repo.anaconda.com/pkgs/main
conda create -n omni python=3.12 -y
conda activate omni
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/rocm6.0
```

---

## 2. Downloading OmniParser Weights
Instead of relying on the broken CLI tool, we used Python to directly fetch the Florence-2 and YOLOv8 weights from HuggingFace, then renamed the caption folder to match the code's expectations.

```bash
python3 -c "
from huggingface_hub import snapshot_download
snapshot_download(
    repo_id='microsoft/OmniParser-v2.0',
    local_dir='weights',
    allow_patterns=['icon_caption/*', 'icon_detect/*']
)"
mv weights/icon_caption weights/icon_caption_florence
```

---

## 3. Fixing Dependencies (The AMD/ROCm Patches)
We installed the specific legacy versions of PaddleOCR and transformers, set up the `flash_attn` bypass dummy folder, and installed missing dependencies like `einops`.

```bash
# Fix PaddleOCR
pip install paddleocr==2.7.3 paddlepaddle==2.6.1 -f https://www.paddlepaddle.org.cn/whl/linux/mkl/avx/stable.html

# Fix Florence-2
pip install transformers==4.41.2

# Bypass flash_attn (AMD fix) and install extras
mkdir -p ~/miniconda3/envs/omni/lib/python3.12/site-packages/flash_attn
touch ~/miniconda3/envs/omni/lib/python3.12/site-packages/flash_attn/__init__.py
pip install einops timm
```

---

## 4. Configuring Port 8080
To avoid conflicts with your preinstalled vLLM and ROCm dashboards (occupying ports 8000, 3000, and 8888), we modified the bottom of `gradio_demo.py` to look like this:

```python
demo.launch(
    server_name="0.0.0.0", 
    server_port=8080, 
    share=False
)
```

---

## 5. Launching the Server
Finally, we spun up the Gradio interface:

```bash
python gradio_demo.py
```

This successfully hosted OmniParser V2 locally at **http://0.0.0.0:8080** (accessible via your DigitalOcean droplet's IP) and generated a public Gradio share link, completely isolated from your existing vLLM instance!


## 🔗 Integrations

Catog Automation proudly integrates and builds upon the foundations of several leading automation projects:

- **Codex**: Orchestration logic and advanced reasoning modules.
- **Desktop Commander**: High-precision desktop control interfaces and OS abstractions.
- **MCP Chrome**: Seamless browser automation via the Model Context Protocol.

---

## 🛡️ Security & Safety

- **Audit Logging**: Every action taken by the agent is logged with timestamps and screenshots.
- **App Whitelisting**: Restrict the agent to specific applications (e.g., Chrome, VS Code).
- **Manual Confirmation**: Optional "Human-in-the-loop" mode for sensitive actions.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

<p align="center">
  Built with ❤️ by the Catog Team
</p>
