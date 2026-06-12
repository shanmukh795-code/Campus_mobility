from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app import models, schemas
import datetime

engine = create_engine('sqlite:///campus_mobility.db')
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
db = SessionLocal()

history = db.query(models.Ride).filter(models.Ride.driver_id == 2, models.Ride.status == 'Completed').all()
ratings = db.query(models.Rating).join(models.Ride).filter(models.Ride.driver_id == 2).all()
ratings_by_ride = {r.ride_id: r for r in ratings}

history_items = []
for r in history:
    item = r.__dict__.copy()
    if r.id in ratings_by_ride:
        item['rating_score'] = ratings_by_ride[r.id].score
        item['rating_feedback'] = ratings_by_ride[r.id].feedback
    else:
        item['rating_score'] = None
        item['rating_feedback'] = None
        
    item['formatted_time'] = r.created_at.strftime("%b %d, %Y %I:%M %p")
    history_items.append(item)

# Try parsing
try:
    print(schemas.DriverStats(total_rides=1, average_rating=5.0, history=history_items).dict())
except Exception as e:
    print("Error:", e)

db.close()
