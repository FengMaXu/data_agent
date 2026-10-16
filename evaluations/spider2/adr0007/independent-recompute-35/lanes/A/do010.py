from work import *
id='local010'
init(id,'无向城市对（名字字典序规范化）','unique city pairs', '''# 独立题解
题目：“Distribute all the unique city pairs into the distance ranges 0, 1000, 2000, 3000, 4000, 5000, and 6000+, based on their average distance of all routes between them. Then how many pairs are there in the distance range with the fewest unique city paires?”
业务文档原文：“This ensures that a flight from City A to City B is treated the same as a flight from City B to City A.”；“the average distance for each city pair is calculated by summing the distances and dividing by the total number of flights between those cities”。因此按flights行权重计算两机场Haversine km，名字无向归并，同名城若存在不擅自删去。不限制时间、状态。
坐标DDL为point，要查看实际存储；城市json用英文名称可读。按[0,1000)、[1000,2000)...[6000,+∞)分箱，包括空箱。输出最少箱的数量，平手标量MIN不会产生任意取箱问题。检查航班与机场唯一键、方向归并与机场路线等权敏感性。
''')
query(id,"SELECT airport_code,city,coordinates FROM airports_data LIMIT 4",'airport-sample.json')
query(id,"SELECT count(*) flights,count(distinct flight_id) ids,count(distinct departure_airport||'>'||arrival_airport) directed_airport_routes FROM flights",'flight-keys.json')
