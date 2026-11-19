/* Compatibilidad Switch (libjuice: las direcciones locales, candidatos «host» de ICE). getifaddrs, en platform/switch.c:
 * una sola, la IPv4 de la consola (gethostid de libnx). GPL-3.0-or-later */
#pragma once
#include <sys/socket.h>
struct ifaddrs {
  struct ifaddrs *ifa_next;
  char *ifa_name;
  unsigned int ifa_flags;
  struct sockaddr *ifa_addr, *ifa_netmask, *ifa_dstaddr;
  void *ifa_data;
};
int getifaddrs(struct ifaddrs **ifap);
void freeifaddrs(struct ifaddrs *ifa);
