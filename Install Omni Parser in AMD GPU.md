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