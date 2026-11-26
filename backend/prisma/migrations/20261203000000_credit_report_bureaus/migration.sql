-- Credit reports from all three bureaus: which bureaus reported each account
ALTER TABLE "CreditReportAccount" ADD COLUMN "reportedBy" "Bureau"[] DEFAULT ARRAY[]::"Bureau"[];
