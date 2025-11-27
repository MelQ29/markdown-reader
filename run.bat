@echo off
if not exist "venv" (
    echo Виртуальное окружение не найдено. Запускаю setup.bat...
    call setup.bat
)

echo Активация виртуального окружения...
call venv\Scripts\activate.bat

echo Запуск MD Reader...
python app.py

