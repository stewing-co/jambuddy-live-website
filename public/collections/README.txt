Place exported ABC collection files here for production builds:

- old_time_jam_tunes_collection.abc
- fhs.abc
- irish_session_top100_collection.abc
- open_hymnal_collection.abc
- roaring_jelly_collection.abc
- nigel_gatherer_collection.abc

During local development inside the Android repo, the ABC pages read directly
from ../app/src/main/assets/tunes/*.abc so you don't need to duplicate files.
For deployment of the website repo alone, copy the files into this folder.
