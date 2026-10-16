SELECT id,
       CASE WHEN score IS NULL THEN 'unrated'
            WHEN score >= 80 THEN 'pass'
            ELSE 'retry' END AS result
FROM attempts
WHERE active = TRUE;
