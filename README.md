lawnchair-ncc
=============

Fork of Lawnchair project (A lightweight clientside JSON document store) but it deals with "node callbacks conventions"


## Why this fork?

I've decided forked the Lawnchair project because I am building a web application (I hope that it will our future business) which, obviously, I need to store data for each user session application cycle; albeit in the time being, I would only need to store during the session, my aim is to use a middleware which allows me decouple the application of the storage system, to provide in the close future a offline storage without rebuilding a big part of the application's core.

So I found the great Lawnchair project, but I realized that in my current application, I would like to manage the errors that some adapters, like HTML5 indexed-db, launches asynchronously, so I thought to use the node callbacks convention rather than develop a Promise interface to tackle it. This decision derived the name of the project ncc = "node callbacks convention".

## Future

So far, I've only ported some adapters and no plugins. In the close future, only I will port the feature that I need to my application, of course, all of them will be added to this project.


## Acknowledges

I want to say many thanks to Brian LeRoux and Lawnchair contributors as well, to start and release under a Open Source License the Lanwchair project.
