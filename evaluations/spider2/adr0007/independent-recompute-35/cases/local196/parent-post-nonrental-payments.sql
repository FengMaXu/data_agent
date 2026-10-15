SELECT payment_id,customer_id,rental_id,amount,payment_date FROM payment WHERE rental_id IS NULL OR rental_id NOT IN(SELECT rental_id FROM rental) ORDER BY customer_id,payment_id
