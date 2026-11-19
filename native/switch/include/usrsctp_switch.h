/* Compatibilidad Switch para usrsctp (-include en Makefile.switch): lo de BSD que libnx/newlib no traen. GPL-3.0-or-later */
#pragma once
#include <sys/types.h>
#include <sys/socket.h>
#include <arpa/inet.h>
#ifndef CMSG_ALIGN
#define CMSG_ALIGN(n) (((n) + sizeof(long) - 1) & ~(sizeof(long) - 1))
#endif
#ifndef UIO_MAXIOV
#define UIO_MAXIOV 1024
#endif
#ifndef ERESTART
#define ERESTART (-1)   /* (como en FreeBSD) */
#endif
