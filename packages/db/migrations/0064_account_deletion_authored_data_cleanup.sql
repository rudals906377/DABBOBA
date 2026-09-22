-- Remove user-authored catalog and exchange copy when an account is deleted,
-- while retaining the request decisions, exchange lifecycle, inventory links,
-- and other transaction evidence required for support and legal records.

UPDATE public.catalog_requests AS request
   SET name = '삭제된 카탈로그 요청',
       reference_url = NULL,
       description = NULL,
       media_id = NULL
  FROM public.users AS account
 WHERE account.id = request.user_id
   AND account.status = 'DELETED'
   AND (
     request.name IS DISTINCT FROM '삭제된 카탈로그 요청'
     OR request.reference_url IS NOT NULL
     OR request.description IS NOT NULL
     OR request.media_id IS NOT NULL
   );

UPDATE public.exchange_listings AS listing
   SET title = '삭제된 교환 게시물',
       details = '삭제된 내용'
  FROM public.users AS account
 WHERE account.id = listing.author_id
   AND account.status = 'DELETED'
   AND (
     listing.title IS DISTINCT FROM '삭제된 교환 게시물'
     OR listing.details IS DISTINCT FROM '삭제된 내용'
   );

UPDATE public.exchange_offers AS offer
   SET message = '삭제된 교환 제안'
  FROM public.users AS account
 WHERE account.id = offer.proposer_id
   AND account.status = 'DELETED'
   AND offer.message IS DISTINCT FROM '삭제된 교환 제안';

-- The deletion worker can locate only a user's catalog requests and can update
-- only the authored fields. Existing exchange SELECT access is required by the
-- blocker check; UPDATE remains column-scoped to authored copy.
GRANT SELECT (user_id),
      UPDATE (name,reference_url,description,media_id)
ON TABLE public.catalog_requests TO dabboba_worker;

GRANT UPDATE (title,details)
ON TABLE public.exchange_listings TO dabboba_worker;

GRANT UPDATE (message)
ON TABLE public.exchange_offers TO dabboba_worker;
