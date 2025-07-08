# Labeling instruction (Annotation method)

1. install and run with Docker

see [this page](https://labelstud.io/guide/start#Run-Label-Studio-on-Docker-and-use-Local-Storage) about path.

```bash
# mac
> docker run -it -p 8080:8080 -v {/path/to}/data:/label-studio/data \
 --env LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true \
 --env LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT=/label-studio/files \
 -v {/path/to}/files:/label-studio/files \
 heartexlabs/label-studio:latest label-studio
```

```bash
# win
# need to include '\' in path
> docker run -it -p 8080:8080 -v {\path\to}\data:/label-studio/data \
 --env LABEL_STUDIO_LOCAL_FILES_SERVING_ENABLED=true \
 --env LABEL_STUDIO_LOCAL_FILES_DOCUMENT_ROOT=/label-studio/files \
 -v {\path\to}\files:/label-studio/files \
 heartexlabs/label-studio:latest label-studio --log-level DEBUG
```

enter [http://0.0.0.0:8080/]()

2. reserve
   1. click on *Create Project*
      1. enter the *Project Name*
      2. open *Labeling Setup*, *Computer Vision* > *Object Detection with Bounding Boxes*
      3. click on *Code* and enter in xml format (see [atHand](atHand.labelstudio.xml) ,[ceiling](ceiling.labelstudio.xml) )
   2. open *Settings*
      1. click on *Settings* > *Cloud Storage* > *Add Source Storage*
      2. set *Storage Type* to *Local files* and enter the  *Absolute local path*.
      3. *Add Strage* -> *Sync Storage* 

3. work
   - Annotate.
   - [reference](https://note.com/asahi_ictrad/n/n9e80d4d516ad)