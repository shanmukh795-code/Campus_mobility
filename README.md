# Real-Time Campus Mobility Platform

**Live Demo:** [https://campus-mobility-pnhw.onrender.com](https://campus-mobility-pnhw.onrender.com)

**Design Document:** https://drive.google.com/drive/folders/1wlkVrQBY2DwW_B3o0kgpv3tfrT7NA06u?usp=drive_link

## Project Overview
This project is a real-time ride management platform designed for campus environments. It enables passengers to request rides and drivers to accept and manage those requests seamlessly. Built to be responsive, scalable, and highly interactive, the platform mirrors core functionalities of real-world ride-hailing applications.

## Technology Stack
- **Backend:** Python 3.14, FastAPI
- **Database:** SQLite (via SQLAlchemy ORM)
- **Real-Time Communication:** WebSockets
- **Authentication:** JWT (JSON Web Tokens) with passlib & bcrypt
- **Frontend:** Pure HTML5, Vanilla JavaScript, and Vanilla CSS (Glassmorphism & Dark Mode)
- **Zero-Build Architecture:** The frontend is served directly as static files by FastAPI for an incredibly smooth local setup.

## Setup Instructions

### Prerequisites
- Python 3.10+ (Tested with 3.14)

### Installation
1. Navigate to the `campus_mobility` directory.
2. Create a virtual environment:
   ```bash
   python -m venv venv
   ```
3. Activate the virtual environment:
   - **Windows:** `.\venv\Scripts\activate`
   - **macOS/Linux:** `source venv/bin/activate`
4. Install dependencies:
   ```bash
   pip install fastapi uvicorn sqlalchemy pyjwt passlib[bcrypt] websockets pydantic[email] python-multipart
   ```

## Running the Application
1. Start the FastAPI application via Uvicorn:
   ```bash
   uvicorn app.main:app --reload
   ```
2. Open your web browser and navigate to:
   [http://localhost:8000](http://localhost:8000)

## Feature List
### Passenger Features
- **User Authentication:** Secure registration and login.
- **Ride Requests:** Specify pickup and destination addresses.
- **Real-Time Status Tracking:** Watch your ride status change live (Requested -> Accepted -> In Progress -> Completed).

### Driver Features
- **Status Toggle:** Go online to receive ride requests.
- **Incoming Requests Feed:** Instantly see incoming ride requests via WebSockets.
- **Ride Lifecycle Management:** Accept rides and update their status.

### Core System
- **Real-Time Engine:** All events are synchronized across clients using WebSockets.
- **Responsive UI:** Premium glassmorphism aesthetic that works on desktop and mobile.
