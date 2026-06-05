#!/bin/bash
# 一键启动手机遥控器服务端(macOS)——在 Finder 里双击本文件即可。
# 首次运行会自动 npm install,之后直接 npm start。
cd "$(dirname "$0")" || exit 1
if ! command -v npm >/dev/null 2>&1; then
  echo "未找到 npm。请先安装 Node.js:https://nodejs.org/"
  read -r -p "按回车关闭窗口…" _
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "首次运行,正在安装依赖(npm install)…"
  npm install || { echo "依赖安装失败。"; read -r -p "按回车关闭窗口…" _; exit 1; }
fi
npm start
read -r -p "服务已退出,按回车关闭窗口…" _
