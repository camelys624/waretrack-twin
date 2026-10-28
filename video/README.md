# WareTrack 社交平台演示视频

新版竖屏 9:16，1080 × 1920，30 fps，约 63 秒，H.264 / AAC MP4。
整段中文旁白与逐句字幕同步；数据图表在第 38 至 56 秒展示，共 18 秒，按讲解突出库存、车辆和吞吐卡片。

使用本地项目中的实际模拟引擎录制，按连续模拟时间推进；镜头、字幕和竖屏布局仅注入录制浏览器，不修改应用页面。

分镜：园区总览 → 左侧进场 → 仓库门联动与装货 → 满载右侧离场 → 叉车载货入库 → 实时图表 → 园区全景。

## 重新生成

先在 8081 端口启动项目静态服务，然后执行：

```sh
video/.venv/bin/python video/make-narration.py
node video/record-social.mjs
```

`narration.json` 保存旁白稿及镜头最短时长。配音使用 Kokoro v1.1 中文模型，在本地生成普通话语音。每句音频的实际时长用于生成分镜、字幕和配音时间线。

模型目录 `video/.models/`：`kokoro-v1.1-zh.onnx`、`voices-v1.1-zh.bin`、`config.json`。模型来源：https://github.com/thewh1teagle/kokoro-onnx/blob/main/examples/chinese.py 。
Python 依赖：`kokoro-onnx`、`misaki-fork[zh]`、`soundfile`、`numpy`。当前 Python 3.14 环境安装 misaki-fork 时需 `--ignore-requires-python`。

可通过 `RECORD_URL` 指定本地服务地址，通过 `PLAYWRIGHT_PACKAGE` 指定 Playwright 安装位置。
录制依赖 Chromium、FFmpeg、中文字体；音轨响度统一后编码为 AAC，画面使用 H.264 及 BT.709 颜色元数据。

产物位于 `video/output/`：

- `waretrack-social-vertical-narrated.mp4`：新版带旁白成片。
- `waretrack-cover-v2.jpg`：新版竖屏封面。
- `waretrack-narration.srt`、`旁白稿.txt`：配音对应字幕和文字。
- `narration-timeline.json`：实际配音及字幕时间线。
- `recording-evidence-v2.json`：模拟状态和分镜记录。
- `waretrack-social-vertical.mp4`：原 35 秒无旁白版本，保留供对比。

配音稿及模拟画面属于项目演示内容；本次未发布到任何社交平台。
