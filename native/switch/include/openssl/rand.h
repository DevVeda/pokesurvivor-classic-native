/* Compatibilidad Switch: usrsctp (user_environment.c, SCTP_USE_OPENSSL_RAND) pide el RAND_bytes de BoringSSL para sus
 * números al azar; en Switch, randomGet de libnx (aleatorio del sistema). Nada más de OpenSSL. GPL-3.0-or-later */
#pragma once
#include <stddef.h>
#define OPENSSL_IS_BORINGSSL 1
void randomGet(void *buf, size_t len);
#define RAND_bytes(b, n) (randomGet((b), (n)), 1)
