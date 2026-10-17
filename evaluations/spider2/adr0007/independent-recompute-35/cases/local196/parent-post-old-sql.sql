WITH fp AS (SELECT customer_id, MIN(payment_date) AS mpd FROM payment GROUP BY customer_id),
fm AS (SELECT p.customer_id AS cid, f.rating AS rating FROM payment p JOIN fp ON fp.customer_id=p.customer_id AND p.payment_date=fp.mpd JOIN rental r ON r.rental_id=p.rental_id JOIN inventory i ON i.inventory_id=r.inventory_id JOIN film f ON f.film_id=i.film_id),
cu AS (SELECT c.customer_id AS cid, (SELECT SUM(amount) FROM payment p WHERE p.customer_id=c.customer_id) AS total_amt, (SELECT COUNT(*) FROM rental r WHERE r.customer_id=c.customer_id) AS n_rentals FROM customer c)
SELECT fm.rating AS rating, ROUND(AVG(cu.total_amt),2) AS avg_total_amount_spent, ROUND(AVG(cu.n_rentals-1),2) AS avg_subsequent_rentals FROM fm JOIN cu ON cu.cid=fm.cid GROUP BY fm.rating ORDER BY fm.rating

