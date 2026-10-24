@echo off
rem ==============================================================================
rem PvZGE Release APK 构建脚本 (开源合规版)
rem 请确保已安装 JDK 17+ 及 Android SDK，并在 local.properties 中配置 sdk.dir
rem ==============================================================================
if "%JAVA_HOME%"=="" (
  echo [WARN] JAVA_HOME 未设置，尝试使用系统默认 Java
)
cd /d "%~dp0\..\android-gardendless"
call gradlew.bat assembleRelease --console=plain > "..\build-release.log" 2>&1
echo EXITCODE=%ERRORLEVEL%
if %ERRORLEVEL% equ 0 (
  echo [SUCCESS] Release 构建成功！产物位于: android-gardendless\app\build\outputs\apk\release\
) else (
  echo [ERROR] 构建失败，详情请查看 build-release.log
)
