import sqlite3
import pprint

conn = sqlite3.connect('campus_mobility.db')
c = conn.cursor()
c.execute("SELECT * FROM ratings")
rows = c.fetchall()
print("Ratings:")
pprint.pprint(rows)

c.execute("SELECT * FROM rides")
rides = c.fetchall()
print("Rides:")
for r in rides:
    print(r)
conn.close()
