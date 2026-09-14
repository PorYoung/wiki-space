# ewiki 检索扩展镜像：postgres:16 + pgvector + zhparser（SEARCH-VECTOR-DESIGN §9.2）
# 构建产物：ewiki/pg16-search:<tag>；私有 CI 构建推送，气隙环境 docker save/load 导入。
#
# 说明：
# - pgvector 固定 v0.8.0（HNSW iterative_scan = strict_order 需要 >= 0.8.0）
# - zhparser 取上游 master（SCWS 分词器随附源内编译），SCWS 使用 hightman/scws v1.2.3
# - 依赖 pgdg 源的 postgresql-server-dev-16 头文件（官方 postgres 镜像已配置 pgdg）
FROM postgres:16

ARG PGVECTOR_VERSION=0.8.0
ARG SCWS_VERSION=1.2.3

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl build-essential git postgresql-server-dev-16 \
    && rm -rf /var/lib/apt/lists/*

# ---- pgvector ----
RUN curl -fsSL "https://codeload.github.com/pgvector/pgvector/tar.gz/refs/tags/v${PGVECTOR_VERSION}" -o /tmp/pgvector.tar.gz \
    && mkdir -p /tmp/pgvector \
    && tar -xzf /tmp/pgvector.tar.gz -C /tmp/pgvector --strip-components=1 \
    && make -C /tmp/pgvector OPTFLAGS="" -j"$(nproc)" \
    && make -C /tmp/pgvector install \
    && rm -rf /tmp/pgvector /tmp/pgvector.tar.gz

# ---- SCWS（zhparser 的分词库）----
RUN curl -fsSL "https://www.xunsearch.com/scws/down/scws-${SCWS_VERSION}.tar.bz2" -o /tmp/scws.tar.bz2 \
    && mkdir -p /tmp/scws \
    && tar -xjf /tmp/scws.tar.bz2 -C /tmp/scws --strip-components=1 \
    && cd /tmp/scws \
    && ./configure --prefix=/usr/local \
    && make -j"$(nproc)" \
    && make install \
    && ldconfig \
    && rm -rf /tmp/scws /tmp/scws.tar.bz2

# ---- zhparser ----
RUN curl -fsSL "https://codeload.github.com/amutu/zhparser/tar.gz/refs/heads/master" -o /tmp/zhparser.tar.gz \
    && mkdir -p /tmp/zhparser \
    && tar -xzf /tmp/zhparser.tar.gz -C /tmp/zhparser --strip-components=1 \
    && make -C /tmp/zhparser -j"$(nproc)" \
    && make -C /tmp/zhparser install \
    && rm -rf /tmp/zhparser /tmp/zhparser.tar.gz

# ---- 清理构建依赖（保留运行时）----
RUN apt-get update \
    && apt-get purge -y --auto-remove build-essential git \
    && rm -rf /var/lib/apt/lists/*

# 允许短词复合切分，提升中文检索召回（SEARCH-VECTOR-DESIGN 迁移 0008 同步按库设置）
ENV ZHPARSER_MULTI_SHORT=on
