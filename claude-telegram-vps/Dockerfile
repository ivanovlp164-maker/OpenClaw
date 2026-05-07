FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    HOME=/home/agent \
    PATH=/home/agent/.local/bin:/home/agent/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    BUN_INSTALL=/home/agent/.bun \
    TERM=xterm-256color \
    LANG=C.UTF-8

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git unzip xz-utils jq \
        python3 python3-pip \
        ripgrep less tini bsdmainutils util-linux \
        sudo \
    && rm -rf /var/lib/apt/lists/*

RUN useradd -m -s /bin/bash -u 1001 agent \
    && echo 'agent ALL=(ALL) NOPASSWD: ALL' > /etc/sudoers.d/agent \
    && chmod 0440 /etc/sudoers.d/agent

USER agent
WORKDIR /home/agent

RUN curl -fsSL https://bun.sh/install | bash

RUN curl -fsSL https://claude.ai/install.sh | bash

RUN mkdir -p /home/agent/.claude /home/agent/.claude/channels/telegram /home/agent/workspace

COPY --chown=agent:agent settings.json /home/agent/.claude/settings.json
COPY --chown=root:root entrypoint.sh /usr/local/bin/entrypoint.sh
USER root
RUN chmod 0755 /usr/local/bin/entrypoint.sh
USER agent

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/entrypoint.sh"]
CMD ["/usr/bin/script", "-qfc", "/home/agent/.local/bin/claude --channels plugin:telegram@claude-plugins-official", "/home/agent/.claude/run.log"]
