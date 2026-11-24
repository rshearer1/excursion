@echo off
rem Renders one quick half-size test picture with the settings in controls.json and opens it.
cd /d "%~dp0"
node blender\stage\test_still.mjs --name my-test --half
if exist "out\current-best\my-test\my-test_1280_graded.jpg" start "" "out\current-best\my-test\my-test_1280_graded.jpg"
pause
