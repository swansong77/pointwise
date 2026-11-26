-- What confirmed a catalog card (issuer listing page vs product page)
ALTER TABLE "CreditCard" ADD COLUMN "verifiedScope" TEXT;
