from flask import Flask, render_template, request, jsonify, send_from_directory
import os
import markdown
from werkzeug.utils import secure_filename

app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # 16MB max file size

# Создаем папку для загрузок, если её нет
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)

ALLOWED_EXTENSIONS = {'md'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/files', methods=['GET'])
def get_files():
    """Получить список всех загруженных .md файлов"""
    files = []
    if os.path.exists(app.config['UPLOAD_FOLDER']):
        for filename in os.listdir(app.config['UPLOAD_FOLDER']):
            if filename.endswith('.md'):
                filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
                file_size = os.path.getsize(filepath)
                files.append({
                    'name': filename,
                    'size': file_size
                })
    # Сортируем по имени
    files.sort(key=lambda x: x['name'])
    return jsonify(files)

@app.route('/api/upload', methods=['POST'])
def upload_file():
    """Загрузить .md файл"""
    if 'file' not in request.files:
        return jsonify({'error': 'Файл не найден'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Файл не выбран'}), 400
    
    if file and allowed_file(file.filename):
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
        return jsonify({'message': 'Файл успешно загружен', 'filename': filename}), 200
    
    return jsonify({'error': 'Недопустимый формат файла. Разрешены только .md файлы'}), 400

@app.route('/api/file/<filename>', methods=['GET'])
def get_file_content(filename):
    """Получить содержимое файла в формате HTML"""
    filename = secure_filename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # Конвертируем markdown в HTML
        html_content = markdown.markdown(
            content,
            extensions=['fenced_code', 'tables', 'codehilite']
        )
        
        return jsonify({'content': html_content, 'filename': filename}), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при чтении файла: {str(e)}'}), 500

@app.route('/api/delete/<filename>', methods=['DELETE'])
def delete_file(filename):
    """Удалить файл"""
    filename = secure_filename(filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    
    if not os.path.exists(filepath):
        return jsonify({'error': 'Файл не найден'}), 404
    
    try:
        os.remove(filepath)
        return jsonify({'message': 'Файл успешно удален'}), 200
    except Exception as e:
        return jsonify({'error': f'Ошибка при удалении файла: {str(e)}'}), 500

if __name__ == '__main__':
    app.run(debug=True, host='127.0.0.1', port=5000)

