---- MODULE UploadChecks ----
EXTENDS Upload

NoErrorWhileUploading == ~(status = "uploading" /\ error # Null)
ErrorOnlyWhenFailed == error # Null => status = "failed"
DoneIsFinal == [][status = "done" => status' = "done"]_vars
====
