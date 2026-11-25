-- Contact details of a site, printed on the receipt under the business header.
-- Both are optional: sites created before this migration keep operating with
-- no address or phone, and the receipt simply prints nothing extra.
ALTER TABLE "Location"
  ADD COLUMN "address" VARCHAR(200),
  ADD COLUMN "phone" VARCHAR(40);
