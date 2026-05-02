-- WIFIZONE ELITE Database Schema
CREATE DATABASE IF NOT EXISTS wifizone_elite;
USE wifizone_elite;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    mac_address VARCHAR(17) UNIQUE NOT NULL,
    device_name VARCHAR(100),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS plans (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    duration_minutes INT NOT NULL,
    price_pesos DECIMAL(10,2) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    plan_id INT NOT NULL,
    start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    end_time TIMESTAMP,
    status ENUM('active','expired','unpaid') DEFAULT 'unpaid',
    reference_txn VARCHAR(100),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (plan_id) REFERENCES plans(id)
);

CREATE TABLE IF NOT EXISTS payments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    session_id INT NOT NULL,
    txn_id VARCHAR(100) UNIQUE NOT NULL,
    amount DECIMAL(10,2) NOT NULL,
    method ENUM('gcash','stripe','manual') NOT NULL,
    status ENUM('pending','success','failed') DEFAULT 'pending',
    paid_at TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS quotas (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    daily_limit_mb INT DEFAULT 2048,
    used_mb INT DEFAULT 0,
    reset_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE KEY uq_quotas_user (user_id)
);

CREATE TABLE IF NOT EXISTS operator_stats (
    id INT AUTO_INCREMENT PRIMARY KEY,
    singleton_guard TINYINT NOT NULL DEFAULT 1 UNIQUE,
    total_clients INT DEFAULT 0,
    total_revenue DECIMAL(15,2) DEFAULT 0.00,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Seed default plans (idempotent — skip existing rows)
INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '1 Hour', 60, 10.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '1 Hour');

INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '4 Hours', 240, 25.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '4 Hours');

INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '12 Hours', 720, 50.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '12 Hours');

INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '24 Hours', 1440, 80.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '24 Hours');

INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '1 Week', 10080, 300.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '1 Week');

INSERT INTO plans (name, duration_minutes, price_pesos)
SELECT '1 Month', 43200, 1000.00 WHERE NOT EXISTS (SELECT 1 FROM plans WHERE name = '1 Month');

-- Bootstrap operator stats row with explicit id=1 (backend assumes id=1 for updates).
-- singleton_guard UNIQUE constraint ensures only one row can ever exist.
INSERT INTO operator_stats (id, singleton_guard, total_clients, total_revenue)
SELECT 1, 1, 0, 0.00 WHERE NOT EXISTS (SELECT 1 FROM operator_stats WHERE id = 1);

-- Migration: add 'manual' to payments.method for existing databases.
-- Safe to run on a fresh install too — no-op if the column definition already
-- includes 'manual' (MySQL ignores MODIFY when the definition is unchanged).
ALTER TABLE payments MODIFY COLUMN method ENUM('gcash','stripe','manual') NOT NULL;
