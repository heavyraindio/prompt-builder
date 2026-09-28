@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Anima 反推台

rem 优先拉启动器（浅蓝界面：开始 / 停止 / 日志 / 外观设置）
if exist "Anima启动器.exe" (
  start "" "Anima启动器.exe"
  exit /b 0
)

rem 没 exe 时才用得上：本机得有 Python 3.10+
where python >nul 2>nul
if errorlevel 1 (
  echo.
  echo   没找到 Anima启动器.exe，本机也没装 Python。
  echo   直接用 Anima启动器.exe 启动即可；或装个 Python 3.10+ 再跑本文件。
  echo.
  pause
  exit /b 1
)
echo.
echo   没找到 Anima启动器.exe，改用命令行起服务（浏览器会自己打开）
echo   关掉这个窗口 = 停止服务
echo.
python server.py
echo.
echo   服务已退出。
pause
