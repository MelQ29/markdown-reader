@echo off
echo Создание виртуального окружения...
python -m venv venv

echo Активация виртуального окружения...
call venv\Scripts\activate.bat

echo Установка зависимостей...
pip install -r requirements.txt

echo.
echo Установка завершена!
echo.
echo Для запуска приложения:
echo 1. Активируйте виртуальное окружение: venv\Scripts\activate
echo 2. Запустите приложение: python app.py
echo.
echo Или используйте скрипт run.bat для автоматического запуска
pause

