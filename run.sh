#!/bin/bash

# Проверка наличия виртуального окружения
if [ ! -d "venv" ]; then
    echo "Виртуальное окружение не найдено. Запускаю setup.sh..."
    ./setup.sh
fi

# Активация виртуального окружения
source venv/bin/activate

# Запуск приложения
echo "Запуск MD Reader..."
python app.py

