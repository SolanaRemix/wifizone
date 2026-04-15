-- WIFIZONE ELITE Database Schema
CREATE DATABASE IF NOT EXISTS wifizone_elite;
USE wifizone_elite;

CREATE TABLE users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mac_address VARCHAR(17) UNIQUE NOT NULL,
    device_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    duration_minutes INT NOT NULL,
    price_pesos DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    status ENUM('active','expired','unpaid','paid') DEFAULT 'unpaid',
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    txn_id VARCHAR(100) UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    method ENUM('gcash','stripe') NOT NULL,
    status ENUM('pending','success','failed') DEFAULT 'pending',
    paid_at TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE quotas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    daily_limit_mb INT DEFAULT 2048,
    used_mb INT DEFAULT 0,
    reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE operator_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    total_clients INT DEFAULT 0,
    total_revenue DECIMAL(15,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed default plans
INSERT INTO plans (name, duration_minutes, price_pesos) VALUES
('1 Hour',   60,    10.00),
('12 Hours', 720,   50.00),
('24 Hours', 1440,  80.00),
('1 Week',   10080, 300.00),
('1 Month',  43200, 1000.00);

-- Bootstrap operator stats row
INSERT INTO operator_stats (total_clients, total_revenue) VALUES (0, 0.00);
